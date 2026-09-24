use super::{Harness, ONE_USDC, START_TIME, WINDOW_SECONDS};
use crate::types::{Error, Status};
use soroban_sdk::symbol_short;
use soroban_sdk::testutils::Ledger as _;

#[test]
fn settle_moves_the_exact_amount_to_the_registered_recipient() {
    let h = Harness::vault();
    let proposal = h.proposal(1, 5_000 * ONE_USDC);
    let id = h.register(&proposal);

    let payer_before = h.balance_of(&h.payer);
    h.client.settle(&id);

    assert_eq!(h.balance_of(&h.recipient), 5_000 * ONE_USDC);
    assert_eq!(h.balance_of(&h.payer), payer_before - 5_000 * ONE_USDC);
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Settled);
}

#[test]
fn settle_works_identically_with_an_external_treasury_as_payer() {
    // Custody model A rather than the vault (Pakta_Plan_Implementacion.md §2.5).
    // Same code path, different `Config.payer` — which is the point: the
    // decision is a deployment parameter, not a fork in the contract.
    let h = Harness::new(false);
    assert_ne!(h.payer, h.contract_id);

    let proposal = h.proposal(2, 8_000 * ONE_USDC);
    let id = h.register(&proposal);
    h.client.settle(&id);

    assert_eq!(h.balance_of(&h.recipient), 8_000 * ONE_USDC);
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Settled);
}

#[test]
fn the_same_payable_cannot_settle_twice() {
    let h = Harness::vault();
    let id = h.register(&h.proposal(3, 5_000 * ONE_USDC));
    h.client.settle(&id);

    assert_eq!(h.client.try_settle(&id), Err(Ok(Error::NotReady)));
    // And crucially, the money moved exactly once.
    assert_eq!(h.balance_of(&h.recipient), 5_000 * ONE_USDC);
}

#[test]
fn an_expired_proof_cannot_settle_even_though_its_status_is_still_ready() {
    // §14.3's revalidation, enforced on-chain rather than trusted off-chain.
    let h = Harness::vault();
    let proposal = h.proposal(4, 5_000 * ONE_USDC);
    let id = h.register(&proposal);
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Ready);

    h.env.ledger().set_timestamp(proposal.expiry + 1);

    assert_eq!(h.client.try_settle(&id), Err(Ok(Error::ProofExpired)));
    assert_eq!(h.balance_of(&h.recipient), 0);
}

#[test]
fn an_unknown_payable_cannot_settle() {
    let h = Harness::vault();
    let ghost = soroban_sdk::BytesN::from_array(&h.env, &[0xEE; 32]);
    assert_eq!(h.client.try_settle(&ghost), Err(Ok(Error::PayableNotFound)));
}

#[test]
fn settle_is_refused_while_paused() {
    let h = Harness::vault();
    let id = h.register(&h.proposal(5, 5_000 * ONE_USDC));
    h.client.set_paused(&true);

    assert_eq!(h.client.try_settle(&id), Err(Ok(Error::Paused)));
    assert_eq!(h.balance_of(&h.recipient), 0);
}

#[test]
fn a_revoked_payable_cannot_settle() {
    // The on-chain brake for stale evidence (Pakta_Division_Trabajo.md §4): without
    // it, off-chain revalidation is advice the gate cannot enforce.
    let h = Harness::vault();
    let proposal = h.proposal(6, 5_000 * ONE_USDC);
    let id = h.register(&proposal);

    h.client
        .revoke_payable(&id, &symbol_short!("WALLET"), &h.sign_revocation(&proposal));
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Revoked);

    assert_eq!(h.client.try_settle(&id), Err(Ok(Error::NotReady)));
    assert_eq!(h.balance_of(&h.recipient), 0);
}

#[test]
fn a_settled_payable_cannot_be_revoked_afterwards() {
    let h = Harness::vault();
    let proposal = h.proposal(7, 5_000 * ONE_USDC);
    let id = h.register(&proposal);
    h.client.settle(&id);

    assert_eq!(
        h.client
            .try_revoke_payable(&id, &symbol_short!("WALLET"), &h.sign_revocation(&proposal)),
        Err(Ok(Error::NotReady))
    );
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Settled);
}

#[test]
fn revocation_is_idempotent_in_effect() {
    let h = Harness::vault();
    let proposal = h.proposal(8, 5_000 * ONE_USDC);
    let id = h.register(&proposal);
    h.client
        .revoke_payable(&id, &symbol_short!("WALLET"), &h.sign_revocation(&proposal));

    // A second revoke is refused rather than silently re-applied, and the
    // status is unchanged either way.
    assert_eq!(
        h.client
            .try_revoke_payable(&id, &symbol_short!("WALLET"), &h.sign_revocation(&proposal)),
        Err(Ok(Error::NotReady))
    );
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Revoked);
}

mod expiry {
    use super::*;

    #[test]
    fn an_expired_payable_can_be_closed_by_anyone() {
        let h = Harness::vault();
        let proposal = h.proposal(10, 5_000 * ONE_USDC);
        let id = h.register(&proposal);

        h.env.ledger().set_timestamp(proposal.expiry + 1);
        h.client.expire(&id);

        assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Expired);
        assert_eq!(h.client.try_settle(&id), Err(Ok(Error::NotReady)));
    }

    #[test]
    fn a_live_payable_cannot_be_expired_early() {
        let h = Harness::vault();
        let id = h.register(&h.proposal(11, 5_000 * ONE_USDC));
        assert_eq!(h.client.try_expire(&id), Err(Ok(Error::ProofNotExpired)));
    }

    #[test]
    fn a_settled_payable_cannot_be_expired() {
        let h = Harness::vault();
        let proposal = h.proposal(12, 5_000 * ONE_USDC);
        let id = h.register(&proposal);
        h.client.settle(&id);

        h.env.ledger().set_timestamp(proposal.expiry + 1);
        assert_eq!(h.client.try_expire(&id), Err(Ok(Error::NotReady)));
        assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Settled);
    }
}

mod spend_window {
    use super::*;

    #[test]
    fn spending_accumulates_within_the_window() {
        let h = Harness::vault();
        let a = h.register(&h.proposal(20, 60_000 * ONE_USDC));
        let b = h.register(&h.proposal(21, 60_000 * ONE_USDC));

        h.client.settle(&a);
        h.client.settle(&b);

        assert_eq!(h.client.get_window().unwrap().spent, 120_000 * ONE_USDC);
    }

    #[test]
    fn the_aggregate_cap_stops_a_settlement_the_per_payable_cap_would_allow() {
        // MAX_PER_PAYABLE is 100k and MAX_PER_WINDOW is 250k, so three
        // individually-legal payables exceed the window. This is the gap
        // Pakta_Division_Trabajo.md §4 pointed out: a per-payable cap alone bounds
        // nothing in aggregate.
        let h = Harness::vault();
        for (i, _) in (0..2).enumerate() {
            let id = h.register(&h.proposal(30 + i as u8, 100_000 * ONE_USDC));
            h.client.settle(&id);
        }

        let third = h.register(&h.proposal(32, 100_000 * ONE_USDC));
        assert_eq!(
            h.client.try_settle(&third),
            Err(Ok(Error::WindowCapExceeded))
        );
        assert_eq!(h.balance_of(&h.recipient), 200_000 * ONE_USDC);
    }

    #[test]
    fn the_window_resets_once_it_elapses() {
        let h = Harness::vault();
        let first = h.register(&h.proposal(40, 100_000 * ONE_USDC));
        h.client.settle(&first);

        h.env
            .ledger()
            .set_timestamp(START_TIME + WINDOW_SECONDS + 1);

        let mut later = h.proposal(41, 100_000 * ONE_USDC);
        later.expiry = START_TIME + WINDOW_SECONDS + 3_600;
        let second = h.register(&later);
        h.client.settle(&second);

        let window = h.client.get_window().unwrap();
        assert_eq!(window.spent, 100_000 * ONE_USDC);
        assert_eq!(window.started_at, START_TIME + WINDOW_SECONDS + 1);
    }

    #[test]
    fn raising_the_cap_does_not_forgive_spend_already_recorded() {
        // Explicitly required by Pakta_Division_Trabajo.md §7: "actualizar límites no
        // reinicia el gasto ya contabilizado en la ventana activa".
        let h = Harness::vault();
        let first = h.register(&h.proposal(50, 100_000 * ONE_USDC));
        h.client.settle(&first);
        assert_eq!(h.client.get_window().unwrap().spent, 100_000 * ONE_USDC);

        h.client.set_limits(
            &(200_000 * ONE_USDC),
            &WINDOW_SECONDS,
            &(500_000 * ONE_USDC),
        );

        assert_eq!(
            h.client.get_window().unwrap().spent,
            100_000 * ONE_USDC,
            "changing limits must not reset the active window"
        );
    }

    #[test]
    fn a_refused_settlement_does_not_consume_window_budget() {
        let h = Harness::vault();
        let a = h.register(&h.proposal(60, 100_000 * ONE_USDC));
        let b = h.register(&h.proposal(61, 100_000 * ONE_USDC));
        h.client.settle(&a);
        h.client.settle(&b);

        let over = h.register(&h.proposal(62, 100_000 * ONE_USDC));
        assert!(h.client.try_settle(&over).is_err());

        // The rejected attempt left the recorded spend untouched, so a smaller
        // payable still fits in what remains.
        assert_eq!(h.client.get_window().unwrap().spent, 200_000 * ONE_USDC);
        let small = h.register(&h.proposal(63, 40_000 * ONE_USDC));
        h.client.settle(&small);
        assert_eq!(h.client.get_window().unwrap().spent, 240_000 * ONE_USDC);
    }
}
