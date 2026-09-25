import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

/**
 * Without the issuer and executor keys, the API must still serve everything
 * read-only and refuse — clearly — anything that would touch the chain.
 */
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, chain: () => undefined });
});

describe("with settlement keys absent", () => {
  it("says so on /health", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json().settlement).toBe("disabled");
  });

  it.each([
    ["POST", "/payables/PAY-INV-001/settle"],
    ["POST", "/agent/run"],
    ["GET", "/vault"],
  ] as const)("%s %s answers 503 with what to configure", async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatch(/PAKTA_ISSUER_SECRET and PAKTA_EXECUTOR_SECRET/);
  });

  it("still serves payables, proofs and the (empty) settlement history", async () => {
    expect((await app.inject({ method: "GET", url: "/payables" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/payables/PAY-INV-001/proof" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/settlements" })).json()).toEqual([]);
  });
});
