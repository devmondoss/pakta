use soroban_sdk::{Bytes, BytesN, Env};

/// The `registration_digest` of `Pakta_Division_Trabajo.md` §7, recomputed on-chain.
///
/// This is the whole point of the design: the contract never trusts a digest
/// handed to it. It rebuilds the 261-byte preimage from its own typed
/// arguments and its own configuration, hashes it, and only then checks the
/// issuer's signature against that. A caller who substitutes the recipient or
/// the amount produces a different digest, and the signature stops verifying.
///
/// The byte layout has a parity test on the TypeScript side
/// (`@pakta/proof-hash`), pinned to the same vector as `test::digest`. If the
/// two ever disagree, that is a settlement that fails in the demo, so the
/// vector is asserted in both languages rather than assumed.
///
/// ```text
/// domain             13  ASCII "PAKTA_REG_V1" + 0x00
/// network_id         32
/// contract_id        32
/// payable_id_hash    32
/// proof_hash         32
/// recipient          32
/// asset_contract_id  32
/// amount             16  i128, big endian
/// policy_hash        32
/// expiry              8  u64, big endian
///                   ---
///                   261
/// ```
pub const DOMAIN: [u8; 13] = *b"PAKTA_REG_V1\0";

pub const PREIMAGE_LEN: u32 = 261;

/// Raw 32-byte forms, not `Address`. Converting an `Address` to its underlying
/// bytes is a separate concern the entry point will own, so that this module
/// stays a pure function of bytes and can be tested against the TS vector
/// without an `Address` in sight.
pub struct RegistrationFields {
    pub network_id: BytesN<32>,
    pub contract_id: BytesN<32>,
    pub payable_id_hash: BytesN<32>,
    pub proof_hash: BytesN<32>,
    pub recipient: BytesN<32>,
    pub asset_contract_id: BytesN<32>,
    pub amount: i128,
    pub policy_hash: BytesN<32>,
    pub expiry: u64,
}

pub fn registration_preimage(env: &Env, fields: &RegistrationFields) -> Bytes {
    let mut preimage = Bytes::new(env);

    preimage.extend_from_array(&DOMAIN);
    preimage.extend_from_array(&fields.network_id.to_array());
    preimage.extend_from_array(&fields.contract_id.to_array());
    preimage.extend_from_array(&fields.payable_id_hash.to_array());
    preimage.extend_from_array(&fields.proof_hash.to_array());
    preimage.extend_from_array(&fields.recipient.to_array());
    preimage.extend_from_array(&fields.asset_contract_id.to_array());
    preimage.extend_from_array(&fields.amount.to_be_bytes());
    preimage.extend_from_array(&fields.policy_hash.to_array());
    preimage.extend_from_array(&fields.expiry.to_be_bytes());

    // A layout drift would otherwise surface as a silent signature mismatch
    // with no indication of which side moved.
    if preimage.len() != PREIMAGE_LEN {
        panic!("registration preimage length does not match the encoding table");
    }

    preimage
}

pub fn registration_digest(env: &Env, fields: &RegistrationFields) -> BytesN<32> {
    env.crypto()
        .sha256(&registration_preimage(env, fields))
        .into()
}

/// Revocation is authorized the same way registration is: by an issuer
/// signature, not by an account.
///
/// The issuer is an Ed25519 verification key, not a Soroban account, so
/// `issuer.require_auth()` is not available to it. Asking the admin to revoke
/// instead would put the decision in the wrong hands — whether the evidence
/// behind a proof went stale is the issuer's judgement, and only the issuer
/// can attest to it.
///
/// A separate domain from `PAKTA_REG_V1` so that a registration signature can
/// never be replayed as a revocation, and vice versa. `proof_hash` binds a
/// revocation to the exact registration it cancels, not merely to the id.
///
/// V2 adds `reason_hash`. In V1 the reason was not signed, so whoever submitted
/// the transaction could write any reason into the `PayableRevoked` event and
/// the indexer would record a justification the issuer never gave. The domain
/// tag changed with the layout so a V1 signature can never be read as V2.
///
/// ```text
/// domain           13  ASCII "PAKTA_REV_V2" + 0x00
/// network_id       32
/// contract_id      32
/// payable_id_hash  32
/// proof_hash       32
/// reason_hash      32  SHA-256 of the reason code as UTF-8
///                 ---
///                 173
/// ```
pub const REVOKE_DOMAIN: [u8; 13] = *b"PAKTA_REV_V2\0";

pub const REVOCATION_PREIMAGE_LEN: u32 = 173;

pub struct RevocationFields {
    pub network_id: BytesN<32>,
    pub contract_id: BytesN<32>,
    pub payable_id_hash: BytesN<32>,
    pub proof_hash: BytesN<32>,
    pub reason_hash: BytesN<32>,
}

pub fn revocation_preimage(env: &Env, fields: &RevocationFields) -> Bytes {
    let mut preimage = Bytes::new(env);

    preimage.extend_from_array(&REVOKE_DOMAIN);
    preimage.extend_from_array(&fields.network_id.to_array());
    preimage.extend_from_array(&fields.contract_id.to_array());
    preimage.extend_from_array(&fields.payable_id_hash.to_array());
    preimage.extend_from_array(&fields.proof_hash.to_array());
    preimage.extend_from_array(&fields.reason_hash.to_array());

    if preimage.len() != REVOCATION_PREIMAGE_LEN {
        panic!("revocation preimage length does not match the encoding table");
    }

    preimage
}

pub fn revocation_digest(env: &Env, fields: &RevocationFields) -> BytesN<32> {
    env.crypto()
        .sha256(&revocation_preimage(env, fields))
        .into()
}

/// A lifecycle attestation: the issuer telling the ledger that an exception
/// was raised, resolved, or reconciled.
///
/// Unlike registration and revocation, this cannot be bound to a `proof_hash`:
/// the payables it describes are mostly BLOCKED ones, and only READY payables
/// are ever registered on-chain. So it binds to the `payable_id` and to a
/// `sequence` the issuer chooses. Nothing is stored — an attestation only emits
/// an event and can never move the gate — so a replay just re-emits an
/// identical event, which the indexer deduplicates on
/// `(payable_id, phase, sequence)`.
///
/// ```text
/// domain           13  ASCII "PAKTA_ATT_V1" + 0x00
/// network_id       32
/// contract_id      32
/// payable_id_hash  32
/// phase             1  0 = blocked, 1 = resolved, 2 = reconciled
/// reason_hash      32  SHA-256 of the reason code as UTF-8
/// sequence          8  u64, big endian
///                 ---
///                 150
/// ```
pub const ATTEST_DOMAIN: [u8; 13] = *b"PAKTA_ATT_V1\0";

pub const ATTESTATION_PREIMAGE_LEN: u32 = 150;

pub struct AttestationFields {
    pub network_id: BytesN<32>,
    pub contract_id: BytesN<32>,
    pub payable_id_hash: BytesN<32>,
    pub phase: u8,
    pub reason_hash: BytesN<32>,
    pub sequence: u64,
}

pub fn attestation_preimage(env: &Env, fields: &AttestationFields) -> Bytes {
    let mut preimage = Bytes::new(env);

    preimage.extend_from_array(&ATTEST_DOMAIN);
    preimage.extend_from_array(&fields.network_id.to_array());
    preimage.extend_from_array(&fields.contract_id.to_array());
    preimage.extend_from_array(&fields.payable_id_hash.to_array());
    preimage.push_back(fields.phase);
    preimage.extend_from_array(&fields.reason_hash.to_array());
    preimage.extend_from_array(&fields.sequence.to_be_bytes());

    if preimage.len() != ATTESTATION_PREIMAGE_LEN {
        panic!("attestation preimage length does not match the encoding table");
    }

    preimage
}

pub fn attestation_digest(env: &Env, fields: &AttestationFields) -> BytesN<32> {
    env.crypto()
        .sha256(&attestation_preimage(env, fields))
        .into()
}

/// SHA-256 of a reason code's UTF-8 bytes — the form both signed digests use.
pub fn reason_hash(env: &Env, reason_code: &soroban_sdk::String) -> BytesN<32> {
    env.crypto().sha256(&reason_code.to_bytes()).into()
}
