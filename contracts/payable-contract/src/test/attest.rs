use super::{Harness, ONE_USDC};
use crate::types::{Error, IssuerSignature, Status};
use ed25519_dalek::SigningKey;
use soroban_sdk::{symbol_short, BytesN, Vec};

// Lifecycle attestations are the issuer's testimonies — an exception raised,
// resolved, reconciled — so the issuer signs them, the same way it signs
// registrations and revocations. They only emit; they can never move the gate.

#[test]
fn a_signed_attestation_is_recorded_without_touching_the_gate() {
    let h = Harness::vault();
    let id = h.register(&h.proposal(1, 5_000 * ONE_USDC));

    h.client.attest_lifecycle(
        &id,
        &h.reason("VENDOR_WALLET_CHANGED"),
        &symbol_short!("blocked"),
        &1,
        &h.sign_attestation(&id, 0, "VENDOR_WALLET_CHANGED", 1),
    );
    h.client.attest_lifecycle(
        &id,
        &h.reason("VENDOR_WALLET_CHANGED"),
        &symbol_short!("resolved"),
        &2,
        &h.sign_attestation(&id, 1, "VENDOR_WALLET_CHANGED", 2),
    );

    assert_eq!(
        h.client.get_payable(&id).unwrap().status,
        Status::Ready,
        "an attestation must never move the gate"
    );
}

#[test]
fn a_blocked_payable_can_be_attested_although_it_was_never_registered() {
    // The common case: exceptions are raised on BLOCKED payables, which never
    // reach the chain. The attestation binds to the id, not to a registration.
    let h = Harness::vault();
    let never_registered = BytesN::from_array(&h.env, &[0x42; 32]);

    h.client.attest_lifecycle(
        &never_registered,
        &h.reason("MISSING_RECEIPT"),
        &symbol_short!("blocked"),
        &7,
        &h.sign_attestation(&never_registered, 0, "MISSING_RECEIPT", 7),
    );
    assert!(h.client.get_payable(&never_registered).is_none());
}

#[test]
fn attesting_needs_no_admin_at_all() {
    // Admin-gated before v4. The signature is the authority now, so any relayer
    // can submit it.
    let h = Harness::vault();
    let id = BytesN::from_array(&h.env, &[0x43; 32]);
    let signatures = h.sign_attestation(&id, 2, "RECONCILED", 1);

    h.env.set_auths(&[]);
    h.client.attest_lifecycle(
        &id,
        &h.reason("RECONCILED"),
        &symbol_short!("reconcil"),
        &1,
        &signatures,
    );
}

mod rejected {
    use super::*;

    fn attempt(h: &Harness, reason: &str, phase: &str, sequence: u64, sigs: &Vec<IssuerSignature>) {
        let id = BytesN::from_array(&h.env, &[0x44; 32]);
        h.client.attest_lifecycle(
            &id,
            &h.reason(reason),
            &soroban_sdk::Symbol::new(&h.env, phase),
            &sequence,
            sigs,
        );
    }

    fn signed(h: &Harness, phase: u8, reason: &str, sequence: u64) -> Vec<IssuerSignature> {
        h.sign_attestation(
            &BytesN::from_array(&h.env, &[0x44; 32]),
            phase,
            reason,
            sequence,
        )
    }

    #[test]
    #[should_panic]
    fn when_the_phase_is_swapped() {
        let h = Harness::vault();
        // Signed as "blocked", submitted as "resolved".
        attempt(&h, "WALLET", "resolved", 1, &signed(&h, 0, "WALLET", 1));
    }

    #[test]
    #[should_panic]
    fn when_the_reason_is_swapped() {
        let h = Harness::vault();
        attempt(
            &h,
            "SOMETHING_ELSE",
            "blocked",
            1,
            &signed(&h, 0, "WALLET", 1),
        );
    }

    #[test]
    #[should_panic]
    fn when_the_sequence_is_swapped() {
        let h = Harness::vault();
        attempt(&h, "WALLET", "blocked", 2, &signed(&h, 0, "WALLET", 1));
    }

    #[test]
    #[should_panic]
    fn when_the_signature_is_forged() {
        let h = Harness::vault();
        let forged = Vec::from_array(
            &h.env,
            [IssuerSignature {
                issuer: h.issuer_pub.clone(),
                signature: BytesN::from_array(&h.env, &[0u8; 64]),
            }],
        );
        attempt(&h, "WALLET", "blocked", 1, &forged);
    }

    #[test]
    fn when_signed_by_an_unauthorized_issuer() {
        let h = Harness::vault();
        let id = BytesN::from_array(&h.env, &[0x44; 32]);
        let rogue = SigningKey::from_bytes(&[13u8; 32]);
        let rogue_pub = BytesN::from_array(&h.env, &rogue.verifying_key().to_bytes());
        let digest = crate::digest::attestation_digest(
            &h.env,
            &crate::digest::AttestationFields {
                network_id: h.network_id.clone(),
                contract_id: crate::address_bytes::address_to_bytes(&h.env, &h.contract_id),
                payable_id_hash: id.clone(),
                phase: 0,
                reason_hash: crate::digest::reason_hash(&h.env, &h.reason("WALLET")),
                sequence: 1,
            },
        );
        let result = h.client.try_attest_lifecycle(
            &id,
            &h.reason("WALLET"),
            &symbol_short!("blocked"),
            &1,
            &h.sign_digest(&digest, &rogue, &rogue_pub),
        );
        assert_eq!(result, Err(Ok(Error::UnknownIssuer)));
    }

    #[test]
    fn when_the_phase_is_unknown() {
        let h = Harness::vault();
        let id = BytesN::from_array(&h.env, &[0x44; 32]);
        let result = h.client.try_attest_lifecycle(
            &id,
            &h.reason("WALLET"),
            &symbol_short!("nonsense"),
            &1,
            &signed(&h, 0, "WALLET", 1),
        );
        assert_eq!(result, Err(Ok(Error::UnknownPhase)));
    }

    #[test]
    fn when_there_are_no_signatures() {
        let h = Harness::vault();
        let id = BytesN::from_array(&h.env, &[0x44; 32]);
        let result = h.client.try_attest_lifecycle(
            &id,
            &h.reason("WALLET"),
            &symbol_short!("blocked"),
            &1,
            &Vec::new(&h.env),
        );
        assert_eq!(result, Err(Ok(Error::ThresholdNotMet)));
    }
}
