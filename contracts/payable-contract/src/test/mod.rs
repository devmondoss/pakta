extern crate std;

mod admin;
mod attest;
mod digest;
mod integration;
mod register;
mod revoke;
mod settle;
mod treasury;
mod v4;

use crate::digest::{
    attestation_digest, reason_hash, registration_digest, revocation_digest, AttestationFields,
    RegistrationFields, RevocationFields,
};
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
pub const VAULT_FUNDING: i128 = 1_000_000 * ONE_USDC;
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
    pub treasury: Address,
    pub asset: Address,
    pub recipient: Address,
    pub issuer_key: SigningKey,
    pub issuer_pub: BytesN<32>,
    pub network_id: BytesN<32>,
}

impl Harness {
    /// `payer_is_vault` picks the custody model without changing a line of
    /// contract code: true funds the contract itself, which is the capped
    /// vault the team agreed on (`Pakta_Plan_Implementacion.md` §2.5); false
    /// funds an external treasury account whose signature the token transfer
    /// would then require. The second is kept covered so the escape hatch
    /// stays a configuration change rather than a rewrite.
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
        let treasury = Address::generate(&env);
        let executor = Address::generate(&env);
        let recipient = Address::generate(&env);

        let sac_admin = Address::generate(&env);
        let asset = env.register_stellar_asset_contract_v2(sac_admin).address();

        let payer = if payer_is_vault {
            contract_id.clone()
        } else {
            Address::generate(&env)
        };
        StellarAssetClient::new(&env, &asset).mint(&payer, &VAULT_FUNDING);

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
            &treasury,
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
            treasury,
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

    pub fn set_time(&self, unix_seconds: u64) {
        self.env.ledger().set_timestamp(unix_seconds);
    }

    /// The test-ledger equivalent of Friendbot: a `G...` address has no account
    /// entry until something creates one, and without it the SAC refuses to open
    /// a trustline ("account entry is missing") — exactly as on testnet. Mirrors
    /// how the SDK itself materializes the issuer account of a test SAC.
    pub fn create_account(&self, account: &Address) {
        use soroban_sdk::xdr;
        use std::rc::Rc;

        let raw = crate::address_bytes::address_to_bytes(&self.env, account).to_array();
        let id = xdr::AccountId(xdr::PublicKey::PublicKeyTypeEd25519(xdr::Uint256(raw)));
        let key = Rc::new(xdr::LedgerKey::Account(xdr::LedgerKeyAccount {
            account_id: id.clone(),
        }));
        let entry = Rc::new(xdr::LedgerEntry {
            data: xdr::LedgerEntryData::Account(xdr::AccountEntry {
                account_id: id,
                balance: 0,
                flags: 0,
                home_domain: Default::default(),
                inflation_dest: None,
                num_sub_entries: 0,
                seq_num: xdr::SequenceNumber(0),
                thresholds: xdr::Thresholds([1; 4]),
                signers: xdr::VecM::default(),
                ext: xdr::AccountEntryExt::V0,
            }),
            last_modified_ledger_seq: 0,
            ext: xdr::LedgerEntryExt::V0,
        });
        self.env
            .host()
            .add_ledger_entry(&key, &entry, None)
            .unwrap();
    }

    /// A real `G...` account cannot hold a Stellar asset without a trustline —
    /// the same rule that bit the demo vendors and the treasury on testnet.
    /// CAP-73's `trust` opens one through the SAC itself.
    pub fn open_trustline(&self, account: &Address) {
        StellarAssetClient::new(&self.env, &self.asset).trust(account);
    }

    /// A vault whose authorization is real rather than mocked, so that
    /// `require_auth` actually has to be satisfied. Used by the tests that
    /// assert an unauthorized caller is turned away.
    pub fn strict_auth() -> Self {
        let h = Self::new(true);
        h.env.set_auths(&[]);
        h
    }

    /// Signs a revocation for an already-registered payable, the way the
    /// off-chain issuer would. A separate domain from registration, so a
    /// registration signature cannot be replayed here.
    pub fn sign_revocation(&self, proposal: &Proposal, reason: &str) -> Vec<IssuerSignature> {
        let digest = revocation_digest(
            &self.env,
            &RevocationFields {
                network_id: self.network_id.clone(),
                contract_id: crate::address_bytes::address_to_bytes(&self.env, &self.contract_id),
                payable_id_hash: proposal.payable_id.clone(),
                proof_hash: proposal.proof_hash.clone(),
                reason_hash: reason_hash(&self.env, &self.reason(reason)),
            },
        );
        self.sign_digest(&digest, &self.issuer_key, &self.issuer_pub)
    }

    /// Reason codes travel as strings so they can be hashed into the signed
    /// digest; the event then carries exactly what the issuer signed.
    pub fn reason(&self, code: &str) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&self.env, code)
    }

    /// Signs a lifecycle attestation. `phase` is 0 blocked, 1 resolved,
    /// 2 reconciled — the byte the contract derives from the phase symbol.
    pub fn sign_attestation(
        &self,
        payable_id: &BytesN<32>,
        phase: u8,
        reason: &str,
        sequence: u64,
    ) -> Vec<IssuerSignature> {
        let digest = attestation_digest(
            &self.env,
            &AttestationFields {
                network_id: self.network_id.clone(),
                contract_id: crate::address_bytes::address_to_bytes(&self.env, &self.contract_id),
                payable_id_hash: payable_id.clone(),
                phase,
                reason_hash: reason_hash(&self.env, &self.reason(reason)),
                sequence,
            },
        );
        self.sign_digest(&digest, &self.issuer_key, &self.issuer_pub)
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
    assert_eq!(harness.client.contract_version(), 4);
}
