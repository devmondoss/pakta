import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FakeGate, Issuer, SettlementAdapter, SettlementAgent } from "@pakta/settlement";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../api/src/app.js";
import { createPaktaTools, type ApiClient } from "../src/tools.js";

/**
 * The MCP tools against the real API, in memory: every call goes
 * MCP tool -> API -> kernel -> proof builder -> issuer -> adapter -> gate.
 * Only the chain is replaced, by an in-memory gate with the contract's rules.
 */

const NOW = new Date("2026-09-25T12:00:00Z");
const issuer = new Issuer(new Uint8Array(32).fill(7));
const gate = new FakeGate(issuer.publicKeyHex);

let app: FastifyInstance;
let tools: ReturnType<typeof createPaktaTools>;

beforeAll(async () => {
  app = await buildApp({
    logger: false,
    now: () => NOW,
    chain: ({ deployment, store, listReady }) => {
      const adapter = new SettlementAdapter({ gate, store, deployment, now: () => NOW });
      const agent = new SettlementAgent({ adapter, gate, store, issuer, deployment, listReady, now: () => NOW });
      return { issuer, gate, adapter, agent };
    },
  });
  const api: ApiClient = async (method, url) => {
    const res = await app.inject({ method, url });
    let body: unknown = res.body;
    try {
      body = res.json();
    } catch {
      // not JSON
    }
    return { status: res.statusCode, body };
  };
  tools = createPaktaTools(api);
});

afterAll(async () => app?.close());

function tool(name: string) {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found as unknown as {
    config: { inputSchema: Record<string, unknown> };
    handler: (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;
  };
}

const text = (r: { content: { text: string }[] }) => r.content.map((c) => c.text).join("\n");

describe("the settle tool's input is the security boundary", () => {
  it("accepts a payable id and nothing else — no amount, no destination", () => {
    expect(Object.keys(tool("settle_payable").config.inputSchema)).toEqual(["payable_id"]);
  });

  it("an injected destination has nowhere to go: the attested wallet is paid, not the one in the prompt", async () => {
    // What a prompt-injected invoice might get an agent to send.
    const injected = { payable_id: "PAY-INV-001", recipient: "GD2RT5W8XKLQPZ1N6MYH9VFJ", amount: "999999" };
    const r = await tool("settle_payable").handler(injected);

    expect(r.isError).toBeFalsy();
    expect(gate.payments).toHaveLength(1);
    expect(gate.payments[0]).toMatchObject({
      recipient: "GAGCMMI5YDAYYVZDMUOZZXEVS3OSSNKTATYHAFMFCCEISRYZH5F4JZI2",
      amount: 50_000_000_000n,
    });
  });
});

describe("an agent operating the treasury", () => {
  it("lists what is payable", async () => {
    const r = await tool("list_payables").handler({ status: "BLOCKED" });
    expect(text(r)).toContain("PAY-INV-003");
    expect(text(r)).toContain("PO_AMOUNT_MISMATCH, owned by PROCUREMENT");
  });

  it("is told exactly why a blocked payable cannot be paid, and who must act", async () => {
    const r = await tool("explain_payable").handler({ payable_id: "PAY-INV-004" });
    expect(text(r)).toMatch(/BLOCKED: VENDOR_WALLET_CHANGED/);
    expect(text(r)).toMatch(/Owner: VENDOR_MASTER/);
    expect(text(r)).toMatch(/Required action: REVERIFY_VENDOR_WALLET/);
  });

  it("wants to pay a blocked payable — and is refused with the reason, not a generic failure", async () => {
    const before = gate.payments.length;
    const r = await tool("settle_payable").handler({ payable_id: "PAY-INV-004" });

    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Refused: PAY-INV-004 is blocked by VENDOR_WALLET_CHANGED/);
    expect(gate.payments).toHaveLength(before);
  });

  it("cannot pay the same payable twice, however often it asks", async () => {
    const r = await tool("settle_payable").handler({ payable_id: "PAY-INV-001" });
    expect(text(r)).toMatch(/already settled — nothing was paid again/);
    expect(gate.payments).toHaveLength(1);
  });

  it("can show the proof chain behind a payment", async () => {
    const r = await tool("get_settlement_proof").handler({ payable_id: "PAY-INV-001" });
    expect(text(r)).toMatch(/settled in https:\/\/stellar\.expert\/explorer\/testnet\/tx\//);
  });

  it("can read the vault", async () => {
    const r = await tool("vault_status").handler({});
    expect(text(r)).toMatch(/USDC available, 0\.00 USDC committed/);
  });

  it("rejects a malformed payable id before it reaches the API", () => {
    const schema = tool("explain_payable").config.inputSchema.payable_id as { safeParse: (v: unknown) => { success: boolean } };
    expect(schema.safeParse("PAY-INV-001").success).toBe(true);
    expect(schema.safeParse("../../vault").success).toBe(false);
  });
});

describe("the server speaks MCP over stdio", () => {
  it("completes the handshake and advertises the five tools", async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const tsx = path.resolve(here, "../node_modules/tsx/dist/cli.mjs");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [tsx, path.resolve(here, "../src/server.ts")],
      env: { ...process.env, PAKTA_API_URL: "http://127.0.0.1:1" },
      stderr: "ignore",
    });
    const client = new Client({ name: "pakta-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools: advertised } = await client.listTools();
      expect(advertised.map((t) => t.name).sort()).toEqual(
        ["explain_payable", "get_settlement_proof", "list_payables", "settle_payable", "vault_status"].sort(),
      );
      const settle = advertised.find((t) => t.name === "settle_payable")!;
      expect(Object.keys((settle.inputSchema as { properties: object }).properties)).toEqual(["payable_id"]);
    } finally {
      await client.close();
    }
  }, 30_000);
});
