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

describe("§25 maestro scene 4: Operations confirms receipt for INV-005", () => {
  it("INV-005 starts BLOCKED with MISSING_RECEIPT", async () => {
    const payable = await getPayable("PAY-INV-005");
    expect(payable.status).toBe("BLOCKED");
    expect(payable.exception?.reason).toBe("MISSING_RECEIPT");
  });

  it("confirming receipt clears the exception — the payable is READY on the very next read", async () => {
    const confirm = await app.inject({
      method: "POST",
      url: "/payables/PAY-INV-005/receipt",
      payload: { confirmedBy: "ops@pakta.demo" },
    });
    expect(confirm.statusCode).toBe(200);
    expect(confirm.json()).toMatchObject({ poId: "PO-73344", confirmedQty: 1, invoicedQty: 1, confirmedBy: "ops@pakta.demo" });

    const payable = await getPayable("PAY-INV-005");
    expect(payable.status).toBe("READY");
    expect(payable.exception).toBeUndefined();
  });

  it("a partial confirmation (confirmedQty < invoicedQty) leaves it BLOCKED as PARTIAL_RECEIPT", async () => {
    const confirm = await app.inject({
      method: "POST",
      url: "/payables/PAY-INV-005/receipt",
      payload: { confirmedQty: 1, invoicedQty: 3, confirmedBy: "ops@pakta.demo" },
    });
    expect(confirm.statusCode).toBe(200);

    const payable = await getPayable("PAY-INV-005");
    expect(payable.status).toBe("BLOCKED");
    expect(payable.exception?.reason).toBe("PARTIAL_RECEIPT");
  });

  it("404s for an unknown payable", async () => {
    const res = await app.inject({ method: "POST", url: "/payables/PAY-NOPE/receipt", payload: {} });
    expect(res.statusCode).toBe(404);
  });
});
