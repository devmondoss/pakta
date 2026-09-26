import type { CanonicalPayable } from "@pakta/canonical-model";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb, resetDb, TEST_SCHEMA, type Db } from "../src/db.js";
import { countPayables, getPayable, listPayables, upsertPayable } from "../src/payables.js";

let db: Db;

beforeAll(async () => {
  db = await openDb(process.env.DATABASE_URL!, TEST_SCHEMA);
});

beforeEach(async () => {
  await resetDb(db);
});

const payable: CanonicalPayable = {
  payableId: "PAY-INV-001",
  invoice: {
    invoiceId: "INV-001",
    poId: "PO-72881",
    vendorId: "VEN-001",
    amount: "5000.00",
    dueDate: new Date("2026-09-23"),
    walletAddress: "GA1CD9F3KXQPLMN7R2WZT8VY",
    sourceHash: "sha256:demo-inv-001",
  },
  vendor: { vendorId: "VEN-001", legalName: "CloudData Inc.", verificationStatus: "VERIFIED" },
  receipts: [],
  approvals: [],
  policyVersion: "FIN-4.2",
};

describe("upsertPayable / getPayable / listPayables", () => {
  it("round-trips a payable, including Date fields, through JSON storage", async () => {
    await upsertPayable(db, payable, new Date("2026-09-24T12:00:00Z"));

    const stored = await getPayable(db, "PAY-INV-001");
    expect(stored).toBeDefined();
    expect(stored!.invoice.dueDate).toBeInstanceOf(Date);
    expect(stored!.invoice.dueDate.toISOString()).toBe(new Date("2026-09-23").toISOString());
    expect(stored!.vendor.legalName).toBe("CloudData Inc.");
  });

  it("returns undefined for a payable that was never ingested", async () => {
    expect(await getPayable(db, "PAY-DOES-NOT-EXIST")).toBeUndefined();
  });

  it("re-ingesting the same payableId overwrites its row instead of duplicating it", async () => {
    await upsertPayable(db, payable, new Date());
    await upsertPayable(db, { ...payable, invoice: { ...payable.invoice, amount: "9999.00" } }, new Date());

    expect(await countPayables(db)).toBe(1);
    const stored = await getPayable(db, "PAY-INV-001");
    expect(stored!.invoice.amount).toBe("9999.00");
  });

  it("lists every ingested payable", async () => {
    await upsertPayable(db, payable, new Date());
    await upsertPayable(db, { ...payable, payableId: "PAY-INV-002", invoice: { ...payable.invoice, invoiceId: "INV-002" } }, new Date());

    const all = await listPayables(db);
    expect(all.map((p) => p.payableId).sort()).toEqual(["PAY-INV-001", "PAY-INV-002"]);
  });
});
