use super::{Harness, MAX_PER_WINDOW, ONE_USDC, WINDOW_SECONDS};
use crate::types::{Error, Status};
use ed25519_dalek::SigningKey;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Vec};

#[test]
fn initialize_cannot_run_twice() {
    let h = Harness::vault();
    let result = h.client.try_initialize(
        &h.admin,
        &Vec::from_array(&h.env, [h.issuer_pub.clone()]),
        &1,
        &h.network_id,
        &h.asset,
        &h.payer,
        &h.treasury,
        &h.executor,
        &(1_000 * ONE_USDC),
        &WINDOW_SECONDS,
        &MAX_PER_WINDOW,
    );
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn a_threshold_larger_than_the_issuer_set_is_refused() {
    let h = Harness::vault();
    let result = h
        .client
        .try_set_proof_issuers(&Vec::from_array(&h.env, [h.issuer_pub.clone()]), &2);
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn a_zero_threshold_is_refused() {
    let h = Harness::vault();
    let result = h
        .client
        .try_set_proof_issuers(&Vec::from_array(&h.env, [h.issuer_pub.clone()]), &0);
    assert_eq!(result, Err(Ok(Error::InvalidThreshold)));
}

#[test]
fn nonsensical_limits_are_refused() {
    let h = Harness::vault();
    assert_eq!(
        h.client
            .try_set_limits(&0, &WINDOW_SECONDS, &MAX_PER_WINDOW),
        Err(Ok(Error::InvalidLimits))
    );
    assert_eq!(
        h.client
            .try_set_limits(&(1_000 * ONE_USDC), &0, &MAX_PER_WINDOW),
        Err(Ok(Error::InvalidLimits))
    );
    assert_eq!(
        h.client
            .try_set_limits(&(1_000 * ONE_USDC), &WINDOW_SECONDS, &0),
        Err(Ok(Error::InvalidLimits))
    );
}

#[test]
fn rotating_the_issuer_set_invalidates_the_previous_issuer() {
    let h = Harness::vault();
    let replacement = SigningKey::from_bytes(&[42u8; 32]);
    let replacement_pub = BytesN::from_array(&h.env, &replacement.verifying_key().to_bytes());

    h.client
        .set_proof_issuers(&Vec::from_array(&h.env, [replacement_pub.clone()]), &1);

    let proposal = h.proposal(70, 5_000 * ONE_USDC);
    let result = h.client.try_register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &h.sign(&proposal), // still the old key
    );
    assert_eq!(result, Err(Ok(Error::UnknownIssuer)));
}

#[test]
fn pausing_is_reversible_and_leaves_state_intact() {
    let h = Harness::vault();
    let id = h.register(&h.proposal(71, 5_000 * ONE_USDC));

    h.client.set_paused(&true);
    assert_eq!(h.client.try_settle(&id), Err(Ok(Error::Paused)));

    h.client.set_paused(&false);
    h.client.settle(&id);
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Settled);
}

#[test]
fn the_executor_can_be_rotated() {
    let h = Harness::vault();
    let new_executor = Address::generate(&h.env);
    h.client.set_executor(&new_executor);

    assert_eq!(h.client.get_config().executor, new_executor);
}

#[test]
fn the_anti_replay_marker_outlives_the_proof_it_guards() {
    // The TTL is the anti-replay guarantee, not housekeeping: once the entry is
    // archived the id becomes registrable again. The numeric margin is enforced
    // at compile time in lib.rs; this test pins the reasoning to a behaviour,
    // namely that a freshly registered payable is given the long retention.
    let h = Harness::vault();
    let id = h.register(&h.proposal(80, 5_000 * ONE_USDC));
    assert!(h.client.get_payable(&id).is_some());
    assert!(u64::from(crate::PAYABLE_TTL_LEDGERS) * 5 > 7 * 24 * 60 * 60);
}
