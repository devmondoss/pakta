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
