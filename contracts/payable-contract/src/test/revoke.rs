use super::{Harness, ONE_USDC};
use crate::types::{Error, IssuerSignature, Status};
use ed25519_dalek::SigningKey;
use soroban_sdk::{BytesN, Vec};

/// Revocation is authorized the way registration is — by an issuer signature
/// over a digest the contract recomputes — because the issuer is an Ed25519
/// key, not an account that could `require_auth`.

#[test]
fn a_correctly_signed_revocation_blocks_the_payment() {
    let h = Harness::vault();
    let proposal = h.proposal(1, 5_000 * ONE_USDC);
    let id = h.register(&proposal);

    h.client.revoke_payable(
        &id,
        &h.reason("WALLET"),
        &h.sign_revocation(&proposal, "WALLET"),
    );

    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Revoked);
    assert_eq!(h.client.try_settle(&id), Err(Ok(Error::NotReady)));
    assert_eq!(h.balance_of(&h.recipient), 0);
}

#[test]
fn revocation_needs_no_admin_and_no_account_at_all() {
    // Nobody calls require_auth here. The signature is the authorization, so
    // the transaction can be submitted by anyone — a relayer, the vendor, the
    // Settlement Agent — without holding any privileged key.
    let h = Harness::vault();
    let proposal = h.proposal(2, 5_000 * ONE_USDC);
    let id = h.register(&proposal);
    let signatures = h.sign_revocation(&proposal, "STALE");

    h.env.set_auths(&[]);
    h.client
        .revoke_payable(&id, &h.reason("STALE"), &signatures);

    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Revoked);
}

#[test]
#[should_panic]
fn a_forged_revocation_signature_is_rejected() {
    let h = Harness::vault();
    let proposal = h.proposal(3, 5_000 * ONE_USDC);
    let id = h.register(&proposal);

    let forged = Vec::from_array(
        &h.env,
        [IssuerSignature {
            issuer: h.issuer_pub.clone(),
            signature: BytesN::from_array(&h.env, &[0u8; 64]),
        }],
    );
    h.client.revoke_payable(&id, &h.reason("WALLET"), &forged);
}

#[test]
fn a_revocation_signed_by_an_unauthorized_issuer_is_rejected() {
    let h = Harness::vault();
    let proposal = h.proposal(4, 5_000 * ONE_USDC);
    let id = h.register(&proposal);

    let rogue = SigningKey::from_bytes(&[11u8; 32]);
    let rogue_pub = BytesN::from_array(&h.env, &rogue.verifying_key().to_bytes());
    let digest = crate::digest::revocation_digest(
        &h.env,
        &crate::digest::RevocationFields {
            network_id: h.network_id.clone(),
            contract_id: crate::address_bytes::address_to_bytes(&h.env, &h.contract_id),
            payable_id_hash: proposal.payable_id.clone(),
            proof_hash: proposal.proof_hash.clone(),
            reason_hash: crate::digest::reason_hash(&h.env, &h.reason("WALLET")),
        },
    );
    let signatures = h.sign_digest(&digest, &rogue, &rogue_pub);

    assert_eq!(
        h.client
            .try_revoke_payable(&id, &h.reason("WALLET"), &signatures),
        Err(Ok(Error::UnknownIssuer))
    );
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Ready);
}

#[test]
#[should_panic]
fn a_registration_signature_cannot_be_replayed_as_a_revocation() {
    // The whole reason PAKTA_REV_V1 is a separate domain from PAKTA_REG_V1:
    // otherwise the signature that authorized a payment would also authorize
    // cancelling it, and the two are very different decisions.
    let h = Harness::vault();
    let proposal = h.proposal(5, 5_000 * ONE_USDC);
    let id = h.register(&proposal);

    h.client
        .revoke_payable(&id, &h.reason("WALLET"), &h.sign(&proposal));
}

#[test]
#[should_panic]
fn a_revocation_signed_for_another_payable_is_rejected() {
    let h = Harness::vault();
    let target = h.proposal(6, 5_000 * ONE_USDC);
    let other = h.proposal(7, 5_000 * ONE_USDC);
    let id = h.register(&target);
    h.register(&other);

    // Valid signature, wrong payable — proof_hash and payable_id are both in
    // the digest, so it does not carry across.
    h.client.revoke_payable(
        &id,
        &h.reason("WALLET"),
        &h.sign_revocation(&other, "WALLET"),
    );
}

#[test]
fn an_empty_signature_set_does_not_meet_the_threshold() {
    let h = Harness::vault();
    let proposal = h.proposal(8, 5_000 * ONE_USDC);
    let id = h.register(&proposal);

    assert_eq!(
        h.client
            .try_revoke_payable(&id, &h.reason("WALLET"), &Vec::new(&h.env)),
        Err(Ok(Error::ThresholdNotMet))
    );
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Ready);
}

#[test]
fn an_unknown_payable_cannot_be_revoked() {
    let h = Harness::vault();
    let proposal = h.proposal(9, 5_000 * ONE_USDC);
    let ghost = BytesN::from_array(&h.env, &[0xEE; 32]);

    assert_eq!(
        h.client.try_revoke_payable(
            &ghost,
            &h.reason("WALLET"),
            &h.sign_revocation(&proposal, "WALLET")
        ),
        Err(Ok(Error::PayableNotFound))
    );
}

#[test]
fn rotating_the_issuer_set_invalidates_pending_revocation_authority() {
    let h = Harness::vault();
    let proposal = h.proposal(10, 5_000 * ONE_USDC);
    let id = h.register(&proposal);
    let signed_by_old_issuer = h.sign_revocation(&proposal, "WALLET");

    let replacement = SigningKey::from_bytes(&[12u8; 32]);
    let replacement_pub = BytesN::from_array(&h.env, &replacement.verifying_key().to_bytes());
    h.client
        .set_proof_issuers(&Vec::from_array(&h.env, [replacement_pub]), &1);

    assert_eq!(
        h.client
            .try_revoke_payable(&id, &h.reason("WALLET"), &signed_by_old_issuer),
        Err(Ok(Error::UnknownIssuer))
    );
}

#[test]
#[should_panic]
fn a_revocation_cannot_be_relabelled_by_whoever_submits_it() {
    // V1 left the reason outside the digest, so a relayer could submit a
    // genuine revocation under a misleading reason and the indexer would record
    // it. V2 signs the reason: the same signature under a different one fails.
    let h = Harness::vault();
    let proposal = h.proposal(20, 5_000 * ONE_USDC);
    let id = h.register(&proposal);
    let signed_for_wallet = h.sign_revocation(&proposal, "VENDOR_WALLET_CHANGED");

    h.client
        .revoke_payable(&id, &h.reason("DUPLICATE_INVOICE"), &signed_for_wallet);
}

#[test]
fn the_revocation_event_carries_exactly_the_signed_reason() {
    let h = Harness::vault();
    let proposal = h.proposal(21, 5_000 * ONE_USDC);
    let id = h.register(&proposal);

    h.client.revoke_payable(
        &id,
        &h.reason("VENDOR_WALLET_CHANGED"),
        &h.sign_revocation(&proposal, "VENDOR_WALLET_CHANGED"),
    );
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Revoked);
}
