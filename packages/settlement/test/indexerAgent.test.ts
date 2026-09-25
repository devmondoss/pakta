import type { ProofOfPayable } from "@pakta/canonical-model";
import { beforeEach, describe, expect, it } from "vitest";
import {
  EventIndexer,
  Issuer,
  MemorySettlementStore,
  SettlementAdapter,
  SettlementAgent,
  loadDeployment,
  type EventPage,
  type EventSource,
  type GateEvent,
  type ReadyPayable,
} from "../src/index.js";
import { FakeGate } from "../src/fakeGate.js";

const deployment = loadDeployment("testnet");
const issuer = new Issuer(new Uint8Array(32).fill(7));
const NOW = new Date("2026-09-25T12:00:00Z");

/** An event source that serves pre-baked pages and remembers the cursor it was asked for. */
class ListSource implements EventSource {
  requestedCursors: (string | undefined)[] = [];
  constructor(private pages: EventPage[]) {}
  async fetch(from: { cursor?: string }): Promise<EventPage> {
    this.requestedCursors.push(from.cursor);
    return this.pages.shift() ?? { events: [], cursor: from.cursor, latestLedger: 2000 };
  }
}

function proofFor(invoice: string, amount: string, expiresAt = "2026-09-27T12:00:00Z"): ProofOfPayable {
  return {
    payable_id: `PAY-${invoice}`,
    invoice_hash: "a".repeat(64),
    po_hash: "b".repeat(64),
    receipt_hash: "c".repeat(64),
    vendor_id: "VEN-001",
    vendor_wallet: "GAGCMMI5YDAYYVZDMUOZZXEVS3OSSNKTATYHAFMFCCEISRYZH5F4JZI2",
    wallet_attestation_version: 1,
    amount,
    asset: "USDC",
    policy_version: "FIN-4.2",
    approvals_hash: "d".repeat(64),
    cost_center: "UNSPECIFIED",
    expires_at: expiresAt,
    status: "READY",
  };
}

function ready(invoice: string, amount: string, expiresAt?: string): ReadyPayable {
  return {
    proof: proofFor(invoice, amount, expiresAt),
    context: { invoiceId: invoice, poId: `PO-${invoice}`, fingerprint: `VEN-001|${amount}` },
  };
}

describe("EventIndexer", () => {
  let store: MemorySettlementStore;

  beforeEach(() => {
    store = new MemorySettlementStore();
  });

  function knownProof(payableIdHash: string) {
    store.upsertProof({
      payableId: "PAY-INV-001",
      payableIdHash,
      proofHash: "e".repeat(64),
      invoiceId: "INV-001",
      poId: "PO-72881",
      vendorId: "VEN-001",
      amount: "5000.00",
      asset: "USDC",
      expiry: 1_790_500_000,
      status: "SIGNED",
    });
  }

  const event = (over: Partial<GateEvent>): GateEvent => ({
    id: "0001",
    type: "settlement_executed",
    ledger: 1500,
    txHash: "f".repeat(64),
    payableIdHash: "1".repeat(64),
    data: {},
    ...over,
  });

  it("records a settlement the adapter never saw — a call that landed but lost its response", async () => {
    knownProof("1".repeat(64));
    const indexer = new EventIndexer({
      source: new ListSource([{ events: [event({})], cursor: "c1", latestLedger: 1500 }]),
      store,
      deployment,
    });

    const report = await indexer.poll();

    expect(report.settlementsRecorded).toEqual(["PAY-INV-001"]);
    expect(store.getSettlement("PAY-INV-001")).toMatchObject({ txHash: "f".repeat(64), ledger: 1500, amount: "5000.00" });
    expect(store.getProof("PAY-INV-001")?.status).toBe("SETTLED");
    expect(store.settledFingerprints.has("VEN-001|5000.00")).toBe(true);
  });

  it("is harmless to replay: the same event twice records one settlement", async () => {
    knownProof("1".repeat(64));
    const page = { events: [event({})], cursor: "c1", latestLedger: 1500 };
    const indexer = new EventIndexer({ source: new ListSource([page, { ...page }]), store, deployment });

    await indexer.poll();
    const second = await indexer.poll();

    expect(second.recorded).toBe(0);
    expect(store.listSettlements()).toHaveLength(1);
  });

  it("resumes from its persisted cursor instead of re-reading history", async () => {
    const source = new ListSource([{ events: [], cursor: "c7", latestLedger: 1600 }]);
    const indexer = new EventIndexer({ source, store, deployment });
    await indexer.poll();
    const afterFirst = source.requestedCursors.length;
    await indexer.poll();
    // Only the very first request starts from scratch; the second cycle picks
    // up from the saved cursor rather than re-reading history.
    expect(source.requestedCursors.filter((c) => c === undefined)).toHaveLength(1);
    expect(source.requestedCursors[afterFirst]).toBe("c7");
  });

  it("keeps settlements it cannot attribute as raw events, and says so", async () => {
    const indexer = new EventIndexer({
      source: new ListSource([{ events: [event({ payableIdHash: "9".repeat(64) })], cursor: "c1", latestLedger: 1 }]),
      store,
      deployment,
    });
    const report = await indexer.poll();
    expect(report.unknownSettlements).toEqual(["9".repeat(64)]);
    expect(store.listSettlements()).toHaveLength(0);
    expect(store.events.size).toBe(1);
  });

  it("tracks registration, revocation and expiry — but never walks a proof backwards", async () => {
    knownProof("1".repeat(64));
    const indexer = new EventIndexer({
      source: new ListSource([
        {
          events: [
            event({ id: "a", type: "payable_registered" }),
            event({ id: "b", type: "settlement_executed" }),
            event({ id: "c", type: "payable_registered" }), // late duplicate signal
          ],
          cursor: "c1",
          latestLedger: 1,
        },
      ]),
      store,
      deployment,
    });
    await indexer.poll();
    expect(store.getProof("PAY-INV-001")?.status).toBe("SETTLED");
  });
});

describe("SettlementAgent", () => {
  let gate: FakeGate;
  let store: MemorySettlementStore;
  let adapter: SettlementAdapter;

  beforeEach(() => {
    gate = new FakeGate(issuer.publicKeyHex);
    store = new MemorySettlementStore();
    adapter = new SettlementAdapter({ gate, store, deployment, now: () => NOW });
  });

  function agent(readyList: ReadyPayable[], indexer?: EventIndexer) {
    return new SettlementAgent({
      adapter,
      gate,
      store,
      issuer,
      deployment,
      indexer,
      listReady: async () => readyList,
      now: () => NOW,
    });
  }

  it("settles every READY payable without a human approving each one", async () => {
    const report = await agent([ready("INV-001", "5000.00"), ready("INV-006", "1200.00")]).runOnce();

    expect(report.settled.map((s) => s.outcome)).toEqual(["SETTLED", "SETTLED"]);
    expect(gate.payments).toHaveLength(2);
    expect(report.failed).toEqual([]);
  });

  it("does not pay twice across cycles", async () => {
    const run = agent([ready("INV-001", "5000.00")]);
    await run.runOnce();
    const second = await run.runOnce();

    expect(second.settled).toEqual([]);
    expect(gate.payments).toHaveLength(1);
  });

  it("settles the soonest-expiring proof first", async () => {
    const report = await agent([
      ready("INV-LATE", "100.00", "2026-09-27T12:00:00Z"),
      ready("INV-SOON", "100.00", "2026-09-25T18:00:00Z"),
    ]).runOnce();
    expect(report.settled.map((s) => s.payableId)).toEqual(["PAY-INV-SOON", "PAY-INV-LATE"]);
  });

  it("skips what the vault cannot cover instead of letting the gate refuse it", async () => {
    gate.balance = 6_000n * 10_000_000n; // room for one 5,000 payable, not two
    const report = await agent([ready("INV-001", "5000.00"), ready("INV-002", "4000.00")]).runOnce();

    expect(report.settled.map((s) => s.payableId)).toEqual(["PAY-INV-001"]);
    expect(report.skipped).toEqual([{ payableId: "PAY-INV-002", reason: expect.stringMatching(/available/) }]);
    expect(gate.payments).toHaveLength(1);
  });

  it("reports a refused payable and keeps going with the rest", async () => {
    const report = await agent([
      ready("INV-STALE", "100.00", "2026-09-25T12:01:00Z"), // expires within the safety margin
      ready("INV-OK", "100.00"),
    ]).runOnce();

    expect(report.failed.map((f) => f.payableId)).toEqual(["PAY-INV-STALE"]);
    expect(report.failed[0]?.reason).toMatch(/STALE_PROOF/);
    expect(report.settled.map((s) => s.payableId)).toEqual(["PAY-INV-OK"]);
  });

  it("sweeps lapsed registrations, releasing the float they held", async () => {
    // A payable registered earlier whose proof has since lapsed.
    const past = ready("INV-OLD", "2000.00", "2026-09-25T12:30:00Z");
    const { signed, prepared } = issuer.sign(past.proof, deployment);
    await gate.registerPayable(prepared, [
      { issuerPublicKeyHex: issuer.publicKeyHex, signature: new Uint8Array(Buffer.from(signed.issuer_signature, "base64")) },
    ]);
    store.upsertProof({
      payableId: past.proof.payable_id,
      payableIdHash: prepared.payableIdHash,
      proofHash: prepared.proofHash,
      invoiceId: "INV-OLD",
      poId: "PO-INV-OLD",
      vendorId: "VEN-001",
      amount: "2000.00",
      asset: "USDC",
      expiry: prepared.expiry,
      status: "REGISTERED",
    });
    expect(gate.committed).toBe(20_000_000_000n);

    const later = new SettlementAgent({
      adapter,
      gate,
      store,
      issuer,
      deployment,
      listReady: async () => [],
      // FakeGate.expireBatch uses the real clock; the proof above is in 2026-09-25.
      now: () => new Date(Math.max(Date.now(), Date.parse("2026-09-26T00:00:00Z"))),
    });
    const report = await later.runOnce();

    expect(report.swept).toBe(1);
    expect(gate.committed).toBe(0n);
    expect(store.getProof("PAY-INV-OLD")?.status).toBe("EXPIRED");
  });

  it("keeps paying when the event source is down — the adapter reads the chain itself", async () => {
    const broken = new EventIndexer({
      source: { fetch: async () => Promise.reject(new Error("RPC unreachable")) },
      store,
      deployment,
    });
    const report = await agent([ready("INV-001", "5000.00")], broken).runOnce();

    expect(report.failed).toEqual([{ payableId: "(indexer)", reason: "RPC unreachable" }]);
    expect(report.settled.map((s) => s.outcome)).toEqual(["SETTLED"]);
  });
});

describe("EventIndexer pagination", () => {
  it("keeps reading past an empty page whose cursor moved — the RPC's scan window, not the end", async () => {
    // Exactly what testnet returned: an empty first page with an advanced
    // cursor, the events on the second, then no further progress.
    const store = new MemorySettlementStore();
    store.upsertProof({
      payableId: "PAY-INV-001",
      payableIdHash: "1".repeat(64),
      proofHash: "e".repeat(64),
      invoiceId: "INV-001",
      poId: "PO-72881",
      vendorId: "VEN-001",
      amount: "5000.00",
      asset: "USDC",
      expiry: 1_790_500_000,
      status: "REGISTERED",
    });
    const source = new ListSource([
      { events: [], cursor: "c1", latestLedger: 100 },
      {
        events: [
          { id: "e1", type: "settlement_executed", ledger: 90, txHash: "f".repeat(64), payableIdHash: "1".repeat(64), data: {} },
        ],
        cursor: "c2",
        latestLedger: 100,
      },
    ]);
    const indexer = new EventIndexer({ source, store, deployment });

    const report = await indexer.poll();

    expect(report.settlementsRecorded).toEqual(["PAY-INV-001"]);
    expect(source.requestedCursors).toEqual([undefined, "c1", "c2"]);
    expect(store.getCursor(`gate:${deployment.contractId}`)?.cursor).toBe("c2");
  });

  it("stops at the page cap even if the source never settles down", async () => {
    let n = 0;
    const endless = { fetch: async () => ({ events: [], cursor: `c${++n}`, latestLedger: 1 }) };
    const indexer = new EventIndexer({ source: endless, store: new MemorySettlementStore(), deployment });
    await indexer.poll(5);
    expect(n).toBe(5);
  });
});
