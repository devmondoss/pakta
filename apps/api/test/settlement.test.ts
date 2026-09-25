import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { resetDb } from "@pakta/db";
import { buildApp } from "../src/app.js";
import { getDb } from "../src/db.js";
import type { ApiPayable } from "../src/mapPayable.js";

let app: FastifyInstance;

beforeAll(async () => {
  await resetDb(await getDb());
  app = await buildApp();
});

async function getPayable(payableId: string): Promise<ApiPayable> {
  const res = await app.inject({ method: "GET", url: "/payables" });
  const payables = res.json() as ApiPayable[];
  return payables.find((p) => p.payableId === payableId)!;
}

const settlementPayload = { asset: "USDC", amount: "5000.00", txHash: "abx932...", ledger: 12345678 };

describe("the Settlement handoff (Dev 1 -> Dev 2)", () => {
  it("refuses to settle a BLOCKED payable", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payables/PAY-INV-002/settlement",
      payload: settlementPayload,
    });
    expect(res.statusCode).toBe(409);
  });

  it("404s settling an unknown payable", async () => {
    const res = await app.inject({ method: "POST", url: "/payables/PAY-NOPE/settlement", payload: settlementPayload });
    expect(res.statusCode).toBe(404);
  });

  it("400s a settlement missing required fields", async () => {
    const res = await app.inject({ method: "POST", url: "/payables/PAY-INV-001/settlement", payload: { asset: "USDC" } });
    expect(res.statusCode).toBe(400);
  });

  it("records a settlement for a READY payable and returns the Settlement contract shape", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payables/PAY-INV-001/settlement",
      payload: settlementPayload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      payable_id: "PAY-INV-001",
      invoice_id: "INV-001",
      po_id: "PO-72881",
      settlement: { network: "stellar", asset: "USDC", amount: "5000.00", tx_hash: "abx932...", ledger: 12345678 },
      status: "SETTLED",
      erp_posting_status: "PENDING",
    });
  });

  it("GET /payables now reports it as SETTLED, not READY", async () => {
    const payable = await getPayable("PAY-INV-001");
    expect(payable.status).toBe("SETTLED");
    expect(payable.settlement).toMatchObject({ txHash: "abx932...", ledger: 12345678 });
  });

  it("GET /payables/:id/settlement returns the recorded settlement", async () => {
    const res = await app.inject({ method: "GET", url: "/payables/PAY-INV-001/settlement" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ payable_id: "PAY-INV-001", status: "SETTLED" });
  });

  it("404s GET settlement for a payable that hasn't been settled", async () => {
    const res = await app.inject({ method: "GET", url: "/payables/PAY-INV-003/settlement" });
    expect(res.statusCode).toBe(404);
  });

  it("refuses a second settlement for the same payable", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/payables/PAY-INV-001/settlement",
      payload: settlementPayload,
    });
    expect(res.statusCode).toBe(409);
  });

  it("GET /summary counts the settled payable separately from ready/blocked", async () => {
    const res = await app.inject({ method: "GET", url: "/summary" });
    const summary = res.json();
    expect(summary.settledCount).toBe(1);
    expect(summary.totalSettled).toBe("5000.00");
    expect(summary.readyCount).toBe(0);
  });
});
