extern crate std;

use super::{hex32, Harness, ONE_USDC};
use crate::types::Status;
use soroban_sdk::{Address, String as SorobanString};

/// Integration across the Dev 2 / Dev 1 boundary, from the contract's side.
///
/// `fixtures/integration/inv-001-registration.json` is written by the
/// TypeScript test `packages/settlement/test/pipelineIntegration.test.ts` from
/// the real pipeline: the demo workbook, through the rules kernel, through
/// Dev 2's proof builder, through the settlement adapter. This test feeds those
/// exact values into the real contract code.
///
/// The one thing it does not reuse is the signature: the fixture's digest is
/// bound to the testnet gate, while this runs in a local environment with its
/// own contract and asset ids. So the harness re-signs over *its* digest with
/// its test issuer. That is not a gap — the digest encoding itself is pinned
/// in both languages by the parity vectors in `test/digest.rs` — and it means
/// what this test proves is precisely the part that was broken: that the
/// values Dev 2 produces are ones the contract accepts and settles.
const FIXTURE: &str = include_str!("../../../../fixtures/integration/inv-001-registration.json");

struct PipelineRegistration {
    payable_id_hash: std::string::String,
    proof_hash: std::string::String,
    recipient: std::string::String,
    amount_units: i128,
    policy_hash: std::string::String,
    expiry: u64,
}

fn load_fixture() -> PipelineRegistration {
    let json: serde_json::Value = serde_json::from_str(FIXTURE).expect("fixture is valid JSON");
    let reg = &json["registration"];
    let text = |key: &str| {
        reg[key]
            .as_str()
            .unwrap_or_else(|| panic!("missing {key}"))
            .into()
    };

    PipelineRegistration {
        payable_id_hash: text("payable_id_hash"),
        proof_hash: text("proof_hash"),
        recipient: text("recipient"),
        amount_units: reg["amount_units"]
            .as_str()
            .expect("amount_units is a decimal string, never a JSON number")
            .parse()
            .expect("amount_units fits an i128"),
        policy_hash: text("policy_hash"),
        expiry: reg["expiry"].as_u64().expect("expiry is u64 seconds"),
    }
}

/// A harness whose recipient is the real vendor account from the pipeline
/// rather than a generated address, with the ledger clock set just before the
/// proof was issued so its expiry is live.
fn harness_for(fixture: &PipelineRegistration) -> (Harness, super::Proposal) {
    let mut h = Harness::vault();
    // `generated_at` in the fixture is 2026-09-23T09:00:00Z; expiry is 48h later.
    h.set_time(fixture.expiry - 48 * 3600);

    let recipient = Address::from_string(&SorobanString::from_str(&h.env, &fixture.recipient));
    h.recipient = recipient.clone();
    // Same two steps the vendors needed on testnet: the account must exist,
    // then it must trust the asset.
    h.create_account(&recipient);
    h.open_trustline(&recipient);

    let proposal = super::Proposal {
        payable_id: hex32(&h.env, &fixture.payable_id_hash),
        proof_hash: hex32(&h.env, &fixture.proof_hash),
        recipient,
        amount: fixture.amount_units,
        policy_hash: hex32(&h.env, &fixture.policy_hash),
        expiry: fixture.expiry,
    };
    (h, proposal)
}

#[test]
fn the_fixture_is_the_canonical_inv_001() {
    let fixture = load_fixture();
    assert_eq!(fixture.amount_units, 5_000 * ONE_USDC);
    assert_eq!(
        fixture.recipient,
        "GAGCMMI5YDAYYVZDMUOZZXEVS3OSSNKTATYHAFMFCCEISRYZH5F4JZI2"
    );
    // FIN-4.2, hashed — the same policy hash the parity vectors pin.
    assert_eq!(
        fixture.policy_hash,
        "368b8ba646b0e0cc299db9c59f94015b605d859e0a636d61221228d2ca59f893"
    );
}

#[test]
fn the_contract_registers_what_the_pipeline_produced() {
    let fixture = load_fixture();
    let (h, proposal) = harness_for(&fixture);

    let id = h.register(&proposal);

    let stored = h.client.get_payable(&id).unwrap();
    assert_eq!(stored.status, Status::Ready);
    assert_eq!(stored.amount, fixture.amount_units);
    assert_eq!(stored.expiry, fixture.expiry);
    assert_eq!(stored.proof_hash, hex32(&h.env, &fixture.proof_hash));
    assert_eq!(h.client.get_committed(), fixture.amount_units);
}

#[test]
fn and_settles_it_to_the_real_vendor_account_for_the_exact_amount() {
    let fixture = load_fixture();
    let (h, proposal) = harness_for(&fixture);
    let id = h.register(&proposal);
    let vault_before = h.balance_of(&h.payer);

    h.client.settle(&id);

    assert_eq!(h.balance_of(&proposal.recipient), fixture.amount_units);
    assert_eq!(h.balance_of(&h.payer), vault_before - fixture.amount_units);
    assert_eq!(h.client.get_payable(&id).unwrap().status, Status::Settled);
    assert_eq!(h.client.get_committed(), 0);
}

#[test]
fn the_pipeline_proof_cannot_be_settled_twice_or_redirected() {
    let fixture = load_fixture();
    let (h, proposal) = harness_for(&fixture);
    let id = h.register(&proposal);
    h.client.settle(&id);

    assert!(
        h.client.try_settle(&id).is_err(),
        "a pipeline proof settled twice"
    );
    assert!(
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
            .is_err(),
        "the same payable id was registered twice"
    );
}
