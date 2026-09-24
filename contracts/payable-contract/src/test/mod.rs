extern crate std;

mod admin;
mod digest;
mod register;
mod settle;

use crate::digest::{registration_digest, RegistrationFields};
use crate::types::IssuerSignature;
use crate::{PayableContract, PayableContractClient};
use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::token::StellarAssetClient;
use soroban_sdk::{Address, BytesN, Env, Vec};

pub const ONE_USDC: i128 = 10_000_000;
pub const MAX_PER_PAYABLE: i128 = 100_000 * ONE_USDC;
pub const MAX_PER_WINDOW: i128 = 250_000 * ONE_USDC;
pub const WINDOW_SECONDS: u64 = 86_400;
pub const START_TIME: u64 = 1_790_000_000;

pub fn hex_nibble(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        _ => panic!("not a lowercase hex character"),
    }
}

pub fn hex32(env: &Env, hex: &str) -> BytesN<32> {
    let chars = hex.as_bytes();
    assert_eq!(chars.len(), 64, "expected 64 hex characters");
    let mut out = [0u8; 32];
    let mut i = 0;
    while i < 32 {
        out[i] = hex_nibble(chars[2 * i]) * 16 + hex_nibble(chars[2 * i + 1]);
        i += 1;
    }
    BytesN::from_array(env, &out)
}

/// A fully wired gate: a test SAC holding real balances, a funded payer, and a
/// real Ed25519 issuer key. Nothing here is mocked — the signatures the tests
/// produce are verified by the same `ed25519_verify` the contract runs on-chain.
pub struct Harness {
    pub env: Env,
    pub client: PayableContractClient<'static>,
    pub contract_id: Address,
    pub admin: Address,
    pub executor: Address,
    pub payer: Address,
    pub asset: Address,
    pub recipient: Address,
    pub issuer_key: SigningKey,
    pub issuer_pub: BytesN<32>,
    pub network_id: BytesN<32>,
}

impl Harness {
    /// `payer_is_vault` picks the custody model (`Pakta_Plan_Web3_Stellar.md`
    /// D1) without changing a line of contract code: true funds the contract
    /// itself, false funds an external treasury account whose signature the
    /// token transfer will then require.
    pub fn new(payer_is_vault: bool) -> Self {
        let env = Env::default();
        // `mock_all_auths` alone is not enough for the external-treasury
        // custody model: there the token's `require_auth` on `from` happens
        // inside the gate's sub-call, i.e. in a non-root position of the auth
        // tree. Worth knowing operationally too — in that model the adapter
        // must attach a Soroban authorization entry for the treasury, not just
        // sign the transaction envelope.
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().set_timestamp(START_TIME);

        let contract_id = env.register(PayableContract, ());
        let client = PayableContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let executor = Address::generate(&env);
        let recipient = Address::generate(&env);

        let sac_admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(sac_admin).address();

        let payer = if payer_is_vault {
            contract_id.clone()
        } else {
            Address::generate(&env)
        };
        StellarAssetClient::new(&env, &asset).mint(&payer, &(1_000_000 * ONE_USDC));

        let issuer_key = SigningKey::from_bytes(&[7u8; 32]);
        let issuer_pub = BytesN::from_array(&env, &issuer_key.verifying_key().to_bytes());
        let network_id = hex32(
            &env,
            "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472",
        );

        client.initialize(
            &admin,
            &Vec::from_array(&env, [issuer_pub.clone()]),
            &1,
            &network_id,
            &asset,
            &payer,
            &executor,
            &MAX_PER_PAYABLE,
            &WINDOW_SECONDS,
            &MAX_PER_WINDOW,
        );

        Self {
            env,
            client,
            contract_id,
            admin,
            executor,
            payer,
            asset,
            recipient,
            issuer_key,
            issuer_pub,
            network_id,
        }
    }

    pub fn vault() -> Self {
        Self::new(true)
    }

    /// Everything needed to register one payable, so a test can vary exactly
    /// one field and leave the rest alone.
    pub fn proposal(&self, id_byte: u8, amount: i128) -> Proposal {
        Proposal {
            payable_id: BytesN::from_array(&self.env, &[id_byte; 32]),
            proof_hash: BytesN::from_array(&self.env, &[id_byte.wrapping_add(100); 32]),
            recipient: self.recipient.clone(),
            amount,
            policy_hash: hex32(
                &self.env,
                "368b8ba646b0e0cc299db9c59f94015b605d859e0a636d61221228d2ca59f893",
            ),
            expiry: START_TIME + 3_600,
        }
    }

    /// Signs the *registration digest*, exactly as the off-chain issuer would.
    /// If any field of `proposal` differs from what is later passed to
    /// `register_payable`, the digest differs and this signature stops
    /// verifying — which is the property the whole design rests on.
    pub fn sign(&self, proposal: &Proposal) -> Vec<IssuerSignature> {
        let fields = RegistrationFields {
            network_id: self.network_id.clone(),
            contract_id: crate::address_bytes::address_to_bytes(&self.env, &self.contract_id),
            payable_id_hash: proposal.payable_id.clone(),
            proof_hash: proposal.proof_hash.clone(),
            recipient: crate::address_bytes::address_to_bytes(&self.env, &proposal.recipient),
            asset_contract_id: crate::address_bytes::address_to_bytes(&self.env, &self.asset),
            amount: proposal.amount,
            policy_hash: proposal.policy_hash.clone(),
            expiry: proposal.expiry,
        };
        let digest = registration_digest(&self.env, &fields);
        self.sign_digest(&digest, &self.issuer_key, &self.issuer_pub)
    }

    pub fn sign_digest(
        &self,
        digest: &BytesN<32>,
        key: &SigningKey,
        public: &BytesN<32>,
    ) -> Vec<IssuerSignature> {
        let signature = key.sign(&digest.to_array());
        Vec::from_array(
            &self.env,
            [IssuerSignature {
                issuer: public.clone(),
                signature: BytesN::from_array(&self.env, &signature.to_bytes()),
            }],
        )
    }

    /// Registers a correctly signed payable and returns its id.
    pub fn register(&self, proposal: &Proposal) -> BytesN<32> {
        self.client.register_payable(
            &proposal.payable_id,
            &proposal.proof_hash,
            &proposal.recipient,
            &proposal.amount,
            &proposal.policy_hash,
            &proposal.expiry,
            &self.sign(proposal),
        );
        proposal.payable_id.clone()
    }

    pub fn balance_of(&self, who: &Address) -> i128 {
        soroban_sdk::token::Client::new(&self.env, &self.asset).balance(who)
    }
}

#[derive(Clone)]
pub struct Proposal {
    pub payable_id: BytesN<32>,
    pub proof_hash: BytesN<32>,
    pub recipient: Address,
    pub amount: i128,
    pub policy_hash: BytesN<32>,
    pub expiry: u64,
}

#[test]
fn contract_version_is_exposed() {
    let harness = Harness::vault();
    assert_eq!(harness.client.contract_version(), 2);
}
