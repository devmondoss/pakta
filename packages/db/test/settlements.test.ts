import { describe, expect, it } from "vitest";
import { createSettlementStore, getSettledFingerprints, openDb, type SettlementRow } from "../src/index.js";

const proof = {
  payableId: "PAY-INV-001",
  payableIdHash: "a".repeat(64),
  proofHash: "b".repeat(64),
  invoiceId: "INV-001",
  poId: "PO-72881",
  vendorId: "VEN-001",
  amount: "5000.00",
  asset: "USDC",
  expiry: 1_790_326_800,
  status: "SIGNED" as const,
};

const settlement: SettlementRow = {
  payableId: "PAY-INV-001",
  invoiceId: "INV-001",
  poId: "PO-72881",
  proofHash: "b".repeat(64),
  contractId: "CBTQDZBJYL2JFQAT64OZYFK4PFOA3EG7CMVZ44FCBSAPDE5EXMTACS6S",
  asset: "USDC",
  amount: "5000.00",
  txHash: "c".repeat(64),
  ledger: 1234,
  erpPostingStatus: "PENDING",
  settledAt: "2026-09-25T12:00:00.000Z",
};

describe("settlement persistence", () => {
  it("traces an on-chain payable id hash back to the business payable", () => {
    const store = createSettlementStore(openDb(":memory:"));
    store.upsertProof(proof);
    expect(store.getProofByIdHash(proof.payableIdHash)?.invoiceId).toBe("INV-001");
    expect(store.getProof("PAY-INV-001")?.payableIdHash).toBe(proof.payableIdHash);
  });

  it("tracks a proof through its lifecycle and lists what the sweep must look at", () => {
    const store = createSettlementStore(openDb(":memory:"));
    store.upsertProof(proof);
    store.setProofStatus(proof.payableIdHash, "REGISTERED", "d".repeat(64));

    expect(store.listOpenRegistrations().map((p) => p.payableId)).toEqual(["PAY-INV-001"]);
    expect(store.getProof("PAY-INV-001")?.registerTxHash).toBe("d".repeat(64));

    store.setProofStatus(proof.payableIdHash, "SETTLED");
    expect(store.listOpenRegistrations()).toEqual([]);
    // A later status change keeps the registration tx it already knew.
    expect(store.getProof("PAY-INV-001")?.registerTxHash).toBe("d".repeat(64));
  });

  it("records a settlement once — a second write for the same payable is ignored", () => {
    const store = createSettlementStore(openDb(":memory:"));
    store.recordSettlement(settlement);
    store.recordSettlement({ ...settlement, txHash: "e".repeat(64), ledger: 9999 });

    expect(store.listSettlements()).toHaveLength(1);
    expect(store.getSettlement("PAY-INV-001")?.txHash).toBe("c".repeat(64));
  });

  it("refuses two settlements claiming the same transaction", () => {
    const store = createSettlementStore(openDb(":memory:"));
    store.recordSettlement(settlement);
    expect(() => store.recordSettlement({ ...settlement, payableId: "PAY-INV-999" })).toThrow();
  });

  it("deduplicates chain events on the RPC's event id", () => {
    const store = createSettlementStore(openDb(":memory:"));
    const event = { id: "0001-0001", type: "settlement_executed", ledger: 1, txHash: "c".repeat(64), payload: { amount: "1" } };

    expect(store.recordChainEvent(event)).toBe(true);
    expect(store.recordChainEvent(event)).toBe(false);
    expect(store.listChainEvents()).toHaveLength(1);
    expect(store.listChainEvents()[0]?.payload).toEqual({ amount: "1" });
  });

  it("persists the indexer's cursor", () => {
    const store = createSettlementStore(openDb(":memory:"));
    expect(store.getCursor("gate")).toBeUndefined();
    store.setCursor("gate", { cursor: "0001-0001", ledger: 42 });
    store.setCursor("gate", { cursor: "0002-0001", ledger: 43 });
    expect(store.getCursor("gate")).toEqual({ cursor: "0002-0001", ledger: 43 });
  });

  it("hands the settled fingerprint back to the kernel's table", () => {
    const db = openDb(":memory:");
    createSettlementStore(db).addSettledFingerprint("VEN-001|5000.00", "settled");
    expect(getSettledFingerprints(db).has("VEN-001|5000.00")).toBe(true);
  });

  it("tracks ERP posting separately from settlement", () => {
    const store = createSettlementStore(openDb(":memory:"));
    store.recordSettlement(settlement);
    store.setErpPostingStatus("PAY-INV-001", "RECONCILED");
    expect(store.getSettlement("PAY-INV-001")?.erpPostingStatus).toBe("RECONCILED");
  });
});
