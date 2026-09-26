import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb, resetDb, TEST_SCHEMA, type Db } from "../src/db.js";
import { AlreadySettledError, getSettlement, listSettlements, recordSettlement } from "../src/settlements.js";

let db: Db;

beforeAll(async () => {
  db = await openDb(process.env.DATABASE_URL!, TEST_SCHEMA);
});

beforeEach(async () => {
  await resetDb(db);
});

const input = {
  payableId: "PAY-INV-001",
  invoiceId: "INV-001",
  poId: "PO-72881",
  asset: "USDC",
  amount: "5000.00",
  txHash: "a".repeat(64),
  ledger: 12345678,
  proofHash: "b".repeat(64),
  contractId: "CBTQDZBJYL2JFQAT64OZYFK4PFOA3EG7CMVZ44FCBSAPDE5EXMTACS6S",
};

describe("recordSettlement", () => {
  it("records a settlement matching the shared Settlement contract shape", async () => {
    const settlement = await recordSettlement(db, input, new Date("2026-09-24T12:00:00Z"));

    expect(settlement).toEqual({
      payable_id: "PAY-INV-001",
      invoice_id: "INV-001",
      po_id: "PO-72881",
      proof_hash: input.proofHash,
      contract_id: input.contractId,
      settlement: { network: "stellar", asset: "USDC", amount: "5000.00", tx_hash: input.txHash, ledger: 12345678 },
      status: "SETTLED",
      erp_posting_status: "PENDING",
    });
  });

  it("defaults erp_posting_status to PENDING but accepts an override", async () => {
    const settlement = await recordSettlement(db, { ...input, erpPostingStatus: "RECONCILED" }, new Date());
    expect(settlement.erp_posting_status).toBe("RECONCILED");
  });

  it("refuses to settle the same payable twice", async () => {
    await recordSettlement(db, input, new Date());
    await expect(recordSettlement(db, input, new Date())).rejects.toThrow(AlreadySettledError);
  });
});

describe("getSettlement / listSettlements", () => {
  it("returns undefined for a payable with no settlement", async () => {
    expect(await getSettlement(db, "PAY-DOES-NOT-EXIST")).toBeUndefined();
  });

  it("lists every recorded settlement", async () => {
    await recordSettlement(db, input, new Date());
    await recordSettlement(db, { ...input, payableId: "PAY-INV-002", invoiceId: "INV-002", txHash: "c".repeat(64) }, new Date());

    expect((await listSettlements(db)).map((s) => s.payable_id).sort()).toEqual(["PAY-INV-001", "PAY-INV-002"]);
  });
});
