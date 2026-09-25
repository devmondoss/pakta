use super::{Harness, MAX_PER_PAYABLE, ONE_USDC, VAULT_FUNDING};
use crate::types::{Error, Status};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::Address;

/// Treasury safety: the vault may never hand back money it has already
/// promised, and the float may never be trapped either.
///
/// `committed` is the running sum of every `READY` payable, and
/// `available = balance - committed` is the only figure `withdraw` may touch.

#[test]
fn a_fresh_vault_has_nothing_committed_and_everything_available() {
    let h = Harness::vault();
    assert_eq!(h.client.get_committed(), 0);
    assert_eq!(h.client.get_available(), VAULT_FUNDING);
}

#[test]
fn registering_commits_and_reduces_what_is_available() {
    let h = Harness::vault();
    h.register(&h.proposal(1, 80_000 * ONE_USDC));

    assert_eq!(h.client.get_committed(), 80_000 * ONE_USDC);
    assert_eq!(h.client.get_available(), VAULT_FUNDING - 80_000 * ONE_USDC);
}

mod the_mandatory_cases {
    use super::*;

    #[test]
    fn withdraw_as_admin_succeeds() {
        let h = Harness::vault();
        let before = h.balance_of(&h.treasury);

        h.client.withdraw(&(1_000 * ONE_USDC));

        assert_eq!(h.balance_of(&h.treasury), before + 1_000 * ONE_USDC);
        assert_eq!(h.balance_of(&h.payer), VAULT_FUNDING - 1_000 * ONE_USDC);
    }

    #[test]
    #[should_panic]
    fn withdraw_as_non_admin_fails() {
        // A harness that does not mock auth, so `admin.require_auth()` is real.
        let h = Harness::strict_auth();
        h.client.withdraw(&(1_000 * ONE_USDC));
    }

    #[test]
    fn withdraw_at_or_below_available_succeeds() {
        let h = Harness::vault();
        h.register(&h.proposal(2, 100_000 * ONE_USDC));
        let free = h.client.get_available();

        h.client.withdraw(&free);

        assert_eq!(h.client.get_available(), 0);
        assert_eq!(h.balance_of(&h.treasury), free);
    }

    #[test]
    fn withdraw_above_available_fails() {
        let h = Harness::vault();
        h.register(&h.proposal(3, 100_000 * ONE_USDC));
        let free = h.client.get_available();

        assert_eq!(
            h.client.try_withdraw(&(free + 1)),
            Err(Ok(Error::WithdrawExceedsAvailable))
        );
        assert_eq!(h.balance_of(&h.treasury), 0);
    }

    #[test]
    fn withdraw_zero_fails() {
        let h = Harness::vault();
        assert_eq!(h.client.try_withdraw(&0), Err(Ok(Error::AmountNotPositive)));
    }

    #[test]
    fn withdraw_negative_fails() {
        // Without the explicit check this would be a transfer of a negative
        // amount, which is to say a deposit from the treasury.
        let h = Harness::vault();
        assert_eq!(
            h.client.try_withdraw(&(-1_000 * ONE_USDC)),
            Err(Ok(Error::AmountNotPositive))
        );
        assert_eq!(h.balance_of(&h.payer), VAULT_FUNDING);
    }

    #[test]
    fn withdraw_when_everything_is_committed_fails() {
        let h = Harness::vault();
        // Ten payables at the per-payable cap commit the entire float.
        let count = VAULT_FUNDING / MAX_PER_PAYABLE;
        for i in 0..count {
            h.register(&h.proposal(10 + i as u8, MAX_PER_PAYABLE));
        }

        assert_eq!(h.client.get_committed(), VAULT_FUNDING);
        assert_eq!(h.client.get_available(), 0);
        assert_eq!(
            h.client.try_withdraw(&1),
            Err(Ok(Error::WithdrawExceedsAvailable))
        );
    }

    #[test]
    fn withdraw_after_settle_reflects_that_the_money_left() {
        // Settling discharges the obligation, so `committed` drops — but the
        // balance dropped by the same amount, so `available` is unchanged.
        // Worth asserting explicitly, because "settle frees up room" is the
        // intuitive reading and it is wrong.
        let h = Harness::vault();
        let id = h.register(&h.proposal(20, 100_000 * ONE_USDC));
        let available_before = h.client.get_available();

        h.client.settle(&id);

        assert_eq!(h.client.get_committed(), 0);
        assert_eq!(h.client.get_available(), available_before);
        assert_eq!(h.balance_of(&h.payer), VAULT_FUNDING - 100_000 * ONE_USDC);

        h.client.withdraw(&available_before);
        assert_eq!(h.client.get_available(), 0);
    }

    #[test]
    fn withdraw_after_revoke_frees_availability() {
        let h = Harness::vault();
        let proposal = h.proposal(21, 100_000 * ONE_USDC);
        let id = h.register(&proposal);
        assert_eq!(h.client.get_available(), VAULT_FUNDING - 100_000 * ONE_USDC);

        h.client.revoke_payable(
            &id,
            &h.reason("WALLET"),
            &h.sign_revocation(&proposal, "WALLET"),
        );

        assert_eq!(h.client.get_committed(), 0);
        assert_eq!(
            h.client.get_available(),
            VAULT_FUNDING,
            "revoking must hand the money back to the free pool"
        );
        h.client.withdraw(&VAULT_FUNDING);
        assert_eq!(h.balance_of(&h.payer), 0);
    }

    #[test]
    fn the_boundary_case_from_the_spec() {
        // Vault = 100, committed = 80 -> withdraw(20) succeeds, withdraw(21)
        // does not. Scaled to USDC units, with the vault trimmed to exactly
        // 100 so the arithmetic is the one being described.
        let h = Harness::vault();
        h.client.withdraw(&(VAULT_FUNDING - 100 * ONE_USDC));
        assert_eq!(h.balance_of(&h.payer), 100 * ONE_USDC);

        h.register(&h.proposal(30, 80 * ONE_USDC));
        assert_eq!(h.client.get_committed(), 80 * ONE_USDC);
        assert_eq!(h.client.get_available(), 20 * ONE_USDC);

        assert_eq!(
            h.client.try_withdraw(&(21 * ONE_USDC)),
            Err(Ok(Error::WithdrawExceedsAvailable))
        );
        h.client.withdraw(&(20 * ONE_USDC));
        assert_eq!(h.client.get_available(), 0);
        assert_eq!(h.balance_of(&h.payer), 80 * ONE_USDC);
    }
}

#[test]
fn expiring_frees_availability_too() {
    let h = Harness::vault();
    let proposal = h.proposal(40, 100_000 * ONE_USDC);
    let id = h.register(&proposal);

    h.env.ledger().set_timestamp(proposal.expiry + 1);
    h.client.expire(&id);

    assert_eq!(h.client.get_committed(), 0);
    assert_eq!(h.client.get_available(), VAULT_FUNDING);
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Expired);
}

#[test]
fn the_vault_cannot_promise_more_than_it_holds() {
    // The other half of treasury safety: over-commitment is refused at
    // registration rather than discovered at settle time by whichever payable
    // happens to run last.
    let h = Harness::vault();
    h.client.withdraw(&(VAULT_FUNDING - 50_000 * ONE_USDC));
    assert_eq!(h.client.get_available(), 50_000 * ONE_USDC);

    h.register(&h.proposal(50, 50_000 * ONE_USDC));
    assert_eq!(h.client.get_available(), 0);

    let over = h.proposal(51, ONE_USDC);
    let result = h.client.try_register_payable(
        &over.payable_id,
        &over.proof_hash,
        &over.recipient,
        &over.amount,
        &over.policy_hash,
        &over.expiry,
        &h.sign(&over),
    );
    assert_eq!(result, Err(Ok(Error::InsufficientAvailable)));
}

#[test]
fn withdraw_is_meaningless_without_a_vault() {
    // With an external treasury as payer the contract holds nothing, so there
    // is nothing for it to hand back.
    let h = Harness::new(false);
    assert_eq!(h.client.try_withdraw(&ONE_USDC), Err(Ok(Error::NotAVault)));
}

#[test]
fn a_settled_payable_does_not_double_release() {
    // Guards the bookkeeping itself: if settle released twice, `available`
    // would drift above the real balance and the vault could be over-drawn.
    let h = Harness::vault();
    let a = h.register(&h.proposal(60, 10_000 * ONE_USDC));
    let b = h.register(&h.proposal(61, 10_000 * ONE_USDC));
    assert_eq!(h.client.get_committed(), 20_000 * ONE_USDC);

    h.client.settle(&a);
    assert!(h.client.try_settle(&a).is_err());
    assert_eq!(h.client.get_committed(), 10_000 * ONE_USDC);

    h.client.settle(&b);
    assert_eq!(h.client.get_committed(), 0);
    assert_eq!(h.client.get_available(), h.balance_of(&h.payer));
}

#[test]
fn withdrawing_everything_then_registering_is_refused_rather_than_failing_later() {
    let h = Harness::vault();
    h.client.withdraw(&VAULT_FUNDING);
    assert_eq!(h.balance_of(&h.payer), 0);

    let proposal = h.proposal(70, ONE_USDC);
    let result = h.client.try_register_payable(
        &proposal.payable_id,
        &proposal.proof_hash,
        &proposal.recipient,
        &proposal.amount,
        &proposal.policy_hash,
        &proposal.expiry,
        &h.sign(&proposal),
    );
    assert_eq!(result, Err(Ok(Error::InsufficientAvailable)));
}

#[test]
fn withdraw_sends_only_to_the_configured_treasury() {
    // The property that keeps an admin key from being a drain key: there is no
    // destination argument at all.
    let h = Harness::vault();
    let stranger = Address::generate(&h.env);

    h.client.withdraw(&(1_000 * ONE_USDC));

    assert_eq!(h.balance_of(&h.treasury), 1_000 * ONE_USDC);
    assert_eq!(h.balance_of(&stranger), 0);
}
