import { beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import type { ApiPayable } from "../src/mapPayable.js";

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });
});

describe("GET /payables", () => {
  it("serves the canonical 5-invoice demo as 1 READY + 4 BLOCKED", async () => {
    const res = await app.inject({ method: "GET", url: "/payables" });
    expect(res.statusCode).toBe(200);
    const payables = res.json() as ApiPayable[];

    expect(payables).toHaveLength(5);
    expect(payables.filter((p) => p.status === "READY")).toHaveLength(1);
    expect(payables.filter((p) => p.status === "BLOCKED")).toHaveLength(4);
  });

  it("matches mock-data.ts's shape exactly for INV-002 (DUPLICATE_INVOICE, owned by AP)", async () => {
    const res = await app.inject({ method: "GET", url: "/payables" });
    const payables = res.json() as ApiPayable[];
    const inv002 = payables.find((p) => p.invoiceId === "INV-002");

    expect(inv002).toMatchObject({
      payableId: "PAY-INV-002",
      vendorName: "Northline Supplies",
      status: "BLOCKED",
      exception: {
        reason: "DUPLICATE_INVOICE",
        severity: "CRITICAL",
        ownerRole: "AP",
      },
    });
  });
});

describe("GET /payables/:payableId/proof", () => {
  it("builds a valid Proof-of-Payable for the READY invoice (INV-001)", async () => {
    const res = await app.inject({ method: "GET", url: "/payables/PAY-INV-001/proof" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      payable_id: "PAY-INV-001",
      vendor_id: "VEN-001",
      amount: "5000.00",
      asset: "USDC",
      status: "READY",
    });
  });

  it("returns 409 for a BLOCKED payable", async () => {
    const res = await app.inject({ method: "GET", url: "/payables/PAY-INV-002/proof" });
    expect(res.statusCode).toBe(409);
  });

  it("returns 404 for an unknown payable", async () => {
    const res = await app.inject({ method: "GET", url: "/payables/PAY-DOES-NOT-EXIST/proof" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /vendors", () => {
  it("returns one entry per distinct vendor in the demo", async () => {
    const res = await app.inject({ method: "GET", url: "/vendors" });
    expect(res.statusCode).toBe(200);
    const vendors = res.json() as unknown[];
    expect(vendors).toHaveLength(5);
  });
});

describe("GET /summary", () => {
  it("matches Pakta_Documento_Maestro.md §25: 28,400 requested, 5,000 ready, 23,400 blocked", async () => {
    const res = await app.inject({ method: "GET", url: "/summary" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      totalRequested: "28400.00",
      totalReady: "5000.00",
      totalBlocked: "23400.00",
      payableCount: 5,
      readyCount: 1,
      blockedCount: 4,
    });
  });
});
