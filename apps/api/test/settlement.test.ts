import { FakeGate, Issuer, SettlementAdapter, SettlementAgent } from "@pakta/settlement";
import { resetDb } from "@pakta/db";
import type { FastifyInstance } from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { getDb } from "../src/db.js";
import type { ApiPayable } from "../src/mapPayable.js";

/**
 * The API end to end, with only the chain replaced by an in-memory gate that
 * enforces the real contract's rules (including the issuer's Ed25519
 * signature). Everything else is real: the workbook, the kernel, the proof
 * builder, the issuer, the adapter, and PostgreSQL's isolated test schema.
 */

const NOW = new Date("2026-09-25T12:00:00Z");
const issuer = new Issuer(new Uint8Array(32).fill(7));
const gate = new FakeGate(issuer.publicKeyHex);

let app: FastifyInstance;

beforeAll(async () => {
  await resetDb(await getDb());
  app = await buildApp({
    logger: false,
    now: () => NOW,
    chain: ({ deployment, store, listReady }) => {
      const adapter = new SettlementAdapter({ gate, store, deployment, now: () => NOW });
      const agent = new SettlementAgent({ adapter, gate, store, issuer, deployment, listReady, now: () => NOW });
      return { issuer, gate, adapter, agent };
    },
  });
});

async function payable(id: string): Promise<ApiPayable> {
  const list = (await app.inject({ method: "GET", url: "/payables" })).json() as ApiPayable[];
  return list.find((p) => p.payableId === id)!;
}

describe("settling through the API", () => {
  it("reports settlement as enabled", async () => {
    const health = (await app.inject({ method: "GET", url: "/health" })).json();
    expect(health).toMatchObject({ status: "ok", settlement: "enabled", network: "testnet" });
  });

  it("refuses a BLOCKED payable, with the kernel's exception, and pays nothing", async () => {
    const res = await app.inject({ method: "POST", url: "/payables/PAY-INV-004/settle" });
    expect(res.statusCode).toBe(409);
    expect(res.json().exception.reason).toBe("VENDOR_WALLET_CHANGED");
    expect(gate.payments).toHaveLength(0);
  });

  it("settles the READY payable for exactly its amount, to its attested wallet", async () => {
    const res = await app.inject({ method: "POST", url: "/payables/PAY-INV-001/settle" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.status).toBe("SETTLED");
    expect(body.settlement).toMatchObject({ payable_id: "PAY-INV-001", invoice_id: "INV-001", po_id: "PO-72881" });
    expect(body.explorerUrl).toMatch(/stellar\.expert\/explorer\/testnet\/tx\/[0-9a-f]{64}/);
    expect(gate.payments).toEqual([
      {
        payableIdHash: expect.any(String),
        recipient: "GAGCMMI5YDAYYVZDMUOZZXEVS3OSSNKTATYHAFMFCCEISRYZH5F4JZI2",
        amount: 50_000_000_000n,
      },
    ]);
  });

  it("then shows it as SETTLED — not as blocked by its own settled fingerprint", async () => {
    const settled = await payable("PAY-INV-001");
    expect(settled.status).toBe("SETTLED");
    expect(settled.settlement?.explorerUrl).toMatch(/\/tx\//);
    expect(settled.exception).toBeUndefined();
  });

  it("is idempotent: settling again pays nothing", async () => {
    const res = await app.inject({ method: "POST", url: "/payables/PAY-INV-001/settle" });
    expect(res.json().status).toBe("ALREADY_SETTLED");
    expect(gate.payments).toHaveLength(1);
  });

  it("the summary counts settled money separately", async () => {
    const summary = (await app.inject({ method: "GET", url: "/summary" })).json();
    expect(summary).toMatchObject({ totalSettled: "5000.00", settledCount: 1, readyCount: 0, blockedCount: 4 });
  });

  it("the vault reports nothing left committed after settling", async () => {
    const vault = (await app.inject({ method: "GET", url: "/vault" })).json();
    expect(vault).toMatchObject({ committed: "0.00", settledCount: 1 });
  });
});

describe("the reconciliation chain (§25)", () => {
  it("walks from the settlement back to the proof that authorized it", async () => {
    const chain = (await app.inject({ method: "GET", url: "/settlements/PAY-INV-001" })).json();
    expect(chain.settlement.txHash).toMatch(/^[0-9a-f]{64}$/);
    expect(chain.proof).toMatchObject({ payableId: "PAY-INV-001", invoiceId: "INV-001", status: "SETTLED" });
    expect(chain.settlement.proofHash).toBe(chain.proof.proofHash);
  });

  it("exports reconciliation as CSV for the spreadsheet the SME already uses", async () => {
    const res = await app.inject({ method: "GET", url: "/reconciliation.csv" });
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const [header, row] = res.body.trim().split("\n");
    expect(header).toContain("payable_id,invoice_id,po_id,amount");
    expect(row).toMatch(/^PAY-INV-001,INV-001,PO-72881,5000\.00,USDC,[0-9a-f]{64},/);
  });
});

describe("demo scene 4: an exception resolves, and the agent pays without a human", () => {
  it("INV-004 is paid to the new wallet once the vendor proves it and it is attested", async () => {
    const newWallet = "GBULRZJR3HMP4DRBMT5OFCO6RIX7QYUC5PVHBCZXXLTBLRTYKZQYIVIN";

    // Nothing to do yet: INV-004 is still blocked.
    const before = (await app.inject({ method: "POST", url: "/agent/run" })).json();
    expect(before.settled).toEqual([]);

    // Vendor Master registers the vendor's new wallet, then attests it.
    await app.inject({ method: "POST", url: "/vendors/VEN-004/wallet", payload: { address: newWallet } });
    await app.inject({ method: "POST", url: "/vendors/VEN-004/wallet/attest" });
    expect((await payable("PAY-INV-004")).status).toBe("READY");

    // The agent's next cycle picks it up on its own.
    const report = (await app.inject({ method: "POST", url: "/agent/run" })).json();
    expect(report.settled).toEqual([expect.objectContaining({ payableId: "PAY-INV-004", outcome: "SETTLED" })]);
    expect(gate.payments.at(-1)).toMatchObject({ recipient: newWallet, amount: 80_000_000_000n });

    expect((await payable("PAY-INV-004")).status).toBe("SETTLED");
  });
});

describe("revocation input checks", () => {
  it("requires a reason", async () => {
    const res = await app.inject({ method: "POST", url: "/payables/PAY-INV-001/revoke", payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("refuses to revoke something this backend never registered", async () => {
    const res = await app.inject({ method: "POST", url: "/payables/PAY-NOPE/revoke", payload: { reason: "STALE" } });
    expect(res.statusCode).toBe(404);
  });
});
