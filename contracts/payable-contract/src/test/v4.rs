use super::{Harness, ONE_USDC, START_TIME};
use crate::types::{Error, Status};
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{Address, BytesN, Vec};

// The v4 additions: a ceiling on proof windows, a stable contract id through
// `upgrade`, recoverable administration, and batch expiry.

mod proof_window {
    use super::*;

    const SEVEN_DAYS: u64 = 7 * 24 * 60 * 60;

    fn register_with_expiry(h: &Harness, id_byte: u8, expiry: u64) -> Result<(), Error> {
        let mut proposal = h.proposal(id_byte, 5_000 * ONE_USDC);
        proposal.expiry = expiry;
        h.client
            .try_register_payable(
                &proposal.payable_id,
                &proposal.proof_hash,
                &proposal.recipient,
                &proposal.amount,
                &proposal.policy_hash,
                &proposal.expiry,
                &h.sign(&proposal),
            )
            .map(|_| ())
            .map_err(|e| e.unwrap())
    }

    #[test]
    fn a_proof_valid_for_exactly_seven_days_is_accepted() {
        let h = Harness::vault();
        assert_eq!(register_with_expiry(&h, 1, START_TIME + SEVEN_DAYS), Ok(()));
    }

    #[test]
    fn a_proof_valid_for_longer_is_refused() {
        // The anti-replay retention is sized against this ceiling; a longer
        // window would quietly outlive the marker that stops re-registration.
        let h = Harness::vault();
        assert_eq!(
            register_with_expiry(&h, 2, START_TIME + SEVEN_DAYS + 1),
            Err(Error::ProofWindowTooLong)
        );
    }

    #[test]
    fn the_48_hour_proofs_dev_2_builds_are_well_inside_it() {
        let h = Harness::vault();
        assert_eq!(register_with_expiry(&h, 3, START_TIME + 48 * 3600), Ok(()));
    }
}

mod upgrade {
    use super::*;

    #[test]
    #[should_panic]
    fn a_non_admin_cannot_upgrade() {
        let h = Harness::strict_auth();
        h.client.upgrade(&BytesN::from_array(&h.env, &[1u8; 32]));
    }

    #[test]
    #[should_panic]
    fn an_upgrade_to_code_that_was_never_uploaded_fails() {
        // The hash must name wasm already on the ledger; a typo cannot brick
        // the contract by pointing it at nothing.
        let h = Harness::vault();
        h.client.upgrade(&BytesN::from_array(&h.env, &[1u8; 32]));
    }
}

mod administration {
    use super::*;

    #[test]
    fn admin_can_be_handed_over_when_both_sides_agree() {
        let h = Harness::vault();
        let next = Address::generate(&h.env);
        h.client.set_admin(&next);
        assert_eq!(h.client.get_config().admin, next);
    }

    #[test]
    #[should_panic]
    fn admin_cannot_be_handed_over_without_the_new_admin_signing() {
        // Guards against a typo handing the gate to an address nobody
        // controls, which would freeze it permanently.
        let h = Harness::strict_auth();
        h.client.set_admin(&Address::generate(&h.env));
    }

    #[test]
    fn the_treasury_can_be_moved_with_the_current_treasury_consenting() {
        let h = Harness::vault();
        let next = Address::generate(&h.env);
        h.client.set_treasury(&next);
        assert_eq!(h.client.get_config().treasury, next);

        h.client.withdraw(&(1_000 * ONE_USDC));
        assert_eq!(h.balance_of(&next), 1_000 * ONE_USDC);
    }

    #[test]
    #[should_panic]
    fn the_treasury_cannot_be_moved_by_the_admin_alone() {
        // Otherwise an admin key could point the treasury at itself and then
        // withdraw — undoing the whole reason the destination is pinned.
        let h = Harness::strict_auth();
        h.client.set_treasury(&Address::generate(&h.env));
    }
}

mod expire_batch {
    use super::*;

    #[test]
    fn sweeps_every_lapsed_payable_and_releases_their_commitments() {
        let h = Harness::vault();
        let a = h.register(&h.proposal(10, 10_000 * ONE_USDC));
        let b = h.register(&h.proposal(11, 20_000 * ONE_USDC));
        assert_eq!(h.client.get_committed(), 30_000 * ONE_USDC);

        h.env.ledger().set_timestamp(START_TIME + 3_601);
        let swept = h
            .client
            .expire_batch(&Vec::from_array(&h.env, [a.clone(), b.clone()]));

        assert_eq!(swept, 2);
        assert_eq!(h.client.get_committed(), 0);
        assert_eq!(h.client.get_payable(&a).unwrap().status, Status::Expired);
        assert_eq!(h.client.get_payable(&b).unwrap().status, Status::Expired);
    }

    #[test]
    fn skips_what_it_cannot_expire_instead_of_failing_the_sweep() {
        // Cleanup must not be hostage to one payable that settled a moment ago.
        let h = Harness::vault();
        let settled = h.register(&h.proposal(20, 10_000 * ONE_USDC));
        h.client.settle(&settled);
        let lapsed = h.register(&h.proposal(21, 10_000 * ONE_USDC));
        let unknown = BytesN::from_array(&h.env, &[0xEE; 32]);

        h.env.ledger().set_timestamp(START_TIME + 3_601);
        let swept = h.client.expire_batch(&Vec::from_array(
            &h.env,
            [settled.clone(), lapsed.clone(), unknown],
        ));

        assert_eq!(swept, 1);
        assert_eq!(
            h.client.get_payable(&settled).unwrap().status,
            Status::Settled
        );
        assert_eq!(
            h.client.get_payable(&lapsed).unwrap().status,
            Status::Expired
        );
    }

    #[test]
    fn does_nothing_while_proofs_are_still_live() {
        let h = Harness::vault();
        let live = h.register(&h.proposal(30, 10_000 * ONE_USDC));
        assert_eq!(
            h.client
                .expire_batch(&Vec::from_array(&h.env, [live.clone()])),
            0
        );
        assert_eq!(h.client.get_payable(&live).unwrap().status, Status::Ready);
    }
}
