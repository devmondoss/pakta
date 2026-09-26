import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb, resetDb, TEST_SCHEMA, type Db } from "../src/db.js";
import { confirmReceipt, getReceipt, seedReceiptIfAbsent } from "../src/receipts.js";

let db: Db;

beforeAll(async () => {
  db = await openDb(process.env.DATABASE_URL!, TEST_SCHEMA);
});

beforeEach(async () => {
  await resetDb(db);
});

describe("seedReceiptIfAbsent", () => {
  it("inserts a receipt that doesn't exist yet", async () => {
    await seedReceiptIfAbsent(db, {
      poId: "PO-72881",
      confirmedQty: 1,
      invoicedQty: 1,
      confirmedBy: "ops@pakta.demo",
      confirmedAt: new Date("2026-09-20"),
    });
    expect(await getReceipt(db, "PO-72881")).toMatchObject({ confirmedQty: 1, invoicedQty: 1 });
  });

  it("never overwrites an existing row", async () => {
    await seedReceiptIfAbsent(db, {
      poId: "PO-72881",
      confirmedQty: 1,
      invoicedQty: 1,
      confirmedBy: "ops@pakta.demo",
      confirmedAt: new Date("2026-09-20"),
    });
    await seedReceiptIfAbsent(db, {
      poId: "PO-72881",
      confirmedQty: 99,
      invoicedQty: 99,
      confirmedBy: "someone-else",
      confirmedAt: new Date("2026-09-20"),
    });
    expect(await getReceipt(db, "PO-72881")).toMatchObject({ confirmedQty: 1 });
  });
});

describe("confirmReceipt — §25 maestro scene 4 (Operations confirms receipt for INV-005)", () => {
  it("returns undefined before any confirmation", async () => {
    expect(await getReceipt(db, "PO-73344")).toBeUndefined();
  });

  it("defaults to a full 1/1 confirmation", async () => {
    const receipt = await confirmReceipt(db, "PO-73344", { confirmedBy: "ops@pakta.demo" }, new Date("2026-09-24"));
    expect(receipt).toMatchObject({ poId: "PO-73344", confirmedQty: 1, invoicedQty: 1, confirmedBy: "ops@pakta.demo" });
  });

  it("accepts an explicit partial confirmation", async () => {
    const receipt = await confirmReceipt(
      db,
      "PO-73344",
      { confirmedQty: 3, invoicedQty: 5, confirmedBy: "ops@pakta.demo" },
      new Date(),
    );
    expect(receipt).toMatchObject({ confirmedQty: 3, invoicedQty: 5 });
  });

  it("a later confirmation for the same PO overwrites the earlier one", async () => {
    await confirmReceipt(db, "PO-73344", { confirmedQty: 1, invoicedQty: 5, confirmedBy: "ops@pakta.demo" }, new Date());
    const updated = await confirmReceipt(
      db,
      "PO-73344",
      { confirmedQty: 5, invoicedQty: 5, confirmedBy: "ops@pakta.demo" },
      new Date(),
    );
    expect(updated.confirmedQty).toBe(5);
  });
});
