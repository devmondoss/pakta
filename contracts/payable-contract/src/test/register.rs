use super::{Harness, ONE_USDC, START_TIME};
use crate::types::{Error, Status};
use ed25519_dalek::SigningKey;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Vec};

#[test]
fn a_correctly_signed_payable_is_registered_as_ready() {
    let h = Harness::vault();
    let proposal = h.proposal(1, 5_000 * ONE_USDC);
    let id = h.register(&proposal);

    let stored = h.client.get_payable(&id).unwrap();
    assert_eq!(stored.status, Status::Ready);
    assert_eq!(stored.amount, proposal.amount);
    assert_eq!(stored.recipient, proposal.recipient);
    assert_eq!(stored.proof_hash, proposal.proof_hash);
    assert_eq!(stored.expiry, proposal.expiry);
}

#[test]
fn the_same_payable_id_can_never_be_registered_twice() {
    // Anti-replay. `payable_id` is the nonce (Pakta_Division_Trabajo.md §7),
    // so a second registration fails even with a perfectly valid signature.
    let h = Harness::vault();
    let proposal = h.proposal(2, 5_000 * ONE_USDC);
    h.register(&proposal);

    let result = h.client.try_register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &h.sign(&proposal),
    );
    assert_eq!(result, Err(Ok(Error::PayableAlreadyExists)));
}

/// The heart of the design: the issuer signs a digest that covers the
/// recipient, the amount, the asset, the expiry, the contract and the network.
/// Handing `register_payable` a different value for any of them leaves the
/// signature verifying a digest the contract never computes, so registration
/// traps.
mod substitution_is_impossible {
    use super::*;

    fn register_with_swapped_field(
        h: &Harness,
        id_byte: u8,
        swap: impl FnOnce(&mut super::super::Proposal),
    ) {
        let signed = h.proposal(id_byte, 5_000 * ONE_USDC);
        let signatures = h.sign(&signed);

        let mut submitted = signed.clone();
        swap(&mut submitted);

        // Signature from the original proposal, arguments from the tampered one.
        h.client.register_payable(
            &submitted.payable_id,
            &submitted.proof_hash,
            &submitted.recipient,
            &submitted.amount,
            &submitted.policy_hash,
            &submitted.expiry,
            &signatures,
        );
    }

    #[test]
    #[should_panic]
    fn a_substituted_recipient_is_rejected() {
        let h = Harness::vault();
        let attacker = Address::generate(&h.env);
        register_with_swapped_field(&h, 10, |p| p.recipient = attacker);
    }

    #[test]
    #[should_panic]
    fn a_substituted_amount_is_rejected() {
        let h = Harness::vault();
        register_with_swapped_field(&h, 11, |p| p.amount = 50_000 * ONE_USDC);
    }

    #[test]
    #[should_panic]
    fn a_substituted_proof_hash_is_rejected() {
        let h = Harness::vault();
        let other = BytesN::from_array(&h.env, &[0xAB; 32]);
        register_with_swapped_field(&h, 12, |p| p.proof_hash = other);
    }

    #[test]
    #[should_panic]
    fn a_substituted_policy_hash_is_rejected() {
        let h = Harness::vault();
        let other = BytesN::from_array(&h.env, &[0xCD; 32]);
        register_with_swapped_field(&h, 13, |p| p.policy_hash = other);
    }

    #[test]
    #[should_panic]
    fn a_substituted_expiry_is_rejected() {
        let h = Harness::vault();
        register_with_swapped_field(&h, 14, |p| p.expiry = START_TIME + 999_999);
    }

    #[test]
    #[should_panic]
    fn a_substituted_payable_id_is_rejected() {
        let h = Harness::vault();
        let other = BytesN::from_array(&h.env, &[0x99; 32]);
        register_with_swapped_field(&h, 15, |p| p.payable_id = other);
    }
}

#[test]
#[should_panic]
fn a_forged_signature_is_rejected() {
    let h = Harness::vault();
    let proposal = h.proposal(20, 5_000 * ONE_USDC);

    // Right issuer key claimed, wrong signature bytes.
    let forged = Vec::from_array(
        &h.env,
        [crate::types::IssuerSignature {
            issuer: h.issuer_pub.clone(),
            signature: BytesN::from_array(&h.env, &[0u8; 64]),
        }],
    );

    h.client.register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &forged,
    );
}

#[test]
fn a_signature_from_an_unauthorized_issuer_is_rejected() {
    let h = Harness::vault();
    let proposal = h.proposal(21, 5_000 * ONE_USDC);

    // A perfectly valid signature — over the right digest — from a key the
    // contract was never told to trust.
    let rogue = SigningKey::from_bytes(&[9u8; 32]);
    let rogue_pub = BytesN::from_array(&h.env, &rogue.verifying_key().to_bytes());
    let fields = crate::digest::RegistrationFields {
        network_id: h.network_id.clone(),
        contract_id: crate::address_bytes::address_to_bytes(&h.env, &h.contract_id),
        payable_id_hash: proposal.payable_id.clone(),
        proof_hash: proposal.proof_hash.clone(),
        recipient: crate::address_bytes::address_to_bytes(&h.env, &proposal.recipient),
        asset_contract_id: crate::address_bytes::address_to_bytes(&h.env, &h.asset),
        amount: proposal.amount,
        policy_hash: proposal.policy_hash.clone(),
        expiry: proposal.expiry,
    };
    let digest = crate::digest::registration_digest(&h.env, &fields);
    let signatures = h.sign_digest(&digest, &rogue, &rogue_pub);

    let result = h.client.try_register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &signatures,
    );
    assert_eq!(result, Err(Ok(Error::UnknownIssuer)));
}

#[test]
fn an_empty_signature_set_does_not_meet_the_threshold() {
    let h = Harness::vault();
    let proposal = h.proposal(22, 5_000 * ONE_USDC);

    let result = h.client.try_register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &Vec::new(&h.env),
    );
    assert_eq!(result, Err(Ok(Error::ThresholdNotMet)));
}

#[test]
fn the_same_issuer_cannot_satisfy_a_threshold_twice() {
    // Raise the threshold to 2 with a single authorized issuer, then try to
    // meet it by repeating that issuer. Counting signatures instead of
    // distinct issuers is exactly the bug flagged in Pakta_Division_Trabajo.md §4.
    let h = Harness::vault();
    h.client
        .set_proof_issuers(&Vec::from_array(&h.env, [h.issuer_pub.clone()]), &1);

    let proposal = h.proposal(23, 5_000 * ONE_USDC);
    let one = h.sign(&proposal);
    let doubled = Vec::from_array(&h.env, [one.get(0).unwrap(), one.get(0).unwrap()]);

    let result = h.client.try_register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &doubled,
    );
    assert_eq!(result, Err(Ok(Error::DuplicateIssuer)));
}

#[test]
fn an_amount_above_the_per_payable_cap_is_rejected() {
    let h = Harness::vault();
    let proposal = h.proposal(30, super::MAX_PER_PAYABLE + 1);

    let result = h.client.try_register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &h.sign(&proposal),
    );
    assert_eq!(result, Err(Ok(Error::AmountAboveCap)));
}

#[test]
fn a_zero_or_negative_amount_is_rejected() {
    let h = Harness::vault();
    for amount in [0i128, -1i128] {
        let proposal = h.proposal(31, amount);
        let result = h.client.try_register_payable(
            &proposal.payable_id,
            &proposal.proof_hash,
            &proposal.recipient,
            &amount,
            &proposal.policy_hash,
            &proposal.expiry,
            &h.sign(&proposal),
        );
        assert_eq!(result, Err(Ok(Error::AmountNotPositive)));
    }
}

#[test]
fn an_already_expired_proof_cannot_be_registered() {
    let h = Harness::vault();
    let mut proposal = h.proposal(32, 5_000 * ONE_USDC);
    proposal.expiry = START_TIME - 1;

    let result = h.client.try_register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &h.sign(&proposal),
    );
    assert_eq!(result, Err(Ok(Error::InvalidExpiry)));
}

#[test]
fn registration_is_refused_while_paused() {
    let h = Harness::vault();
    h.client.set_paused(&true);

    let proposal = h.proposal(33, 5_000 * ONE_USDC);
    let result = h.client.try_register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &h.sign(&proposal),
    );
    assert_eq!(result, Err(Ok(Error::Paused)));
}

#[test]
fn a_proof_signed_for_another_deployment_does_not_carry_over() {
    // Same issuer, same everything — but signed against a different network id.
    // This is what stops a testnet proof from being replayed on mainnet.
    let h = Harness::vault();
    let proposal = h.proposal(40, 5_000 * ONE_USDC);

    let fields = crate::digest::RegistrationFields {
        network_id: BytesN::from_array(&h.env, &[0xFF; 32]),
        contract_id: crate::address_bytes::address_to_bytes(&h.env, &h.contract_id),
        payable_id_hash: proposal.payable_id.clone(),
        proof_hash: proposal.proof_hash.clone(),
        recipient: crate::address_bytes::address_to_bytes(&h.env, &proposal.recipient),
        asset_contract_id: crate::address_bytes::address_to_bytes(&h.env, &h.asset),
        amount: proposal.amount,
        policy_hash: proposal.policy_hash.clone(),
        expiry: proposal.expiry,
    };
    let digest = crate::digest::registration_digest(&h.env, &fields);
    let signatures = h.sign_digest(&digest, &h.issuer_key, &h.issuer_pub);

    let result = h.client.try_register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &signatures,
    );
    assert!(result.is_err(), "a foreign-network proof must not register");
}
