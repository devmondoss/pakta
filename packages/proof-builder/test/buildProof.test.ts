import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestWorkbook } from "@pakta/ingestion";
import { evaluateBatch, loadPolicyFromYaml, type KernelResult } from "@pakta/rules-kernel";
import { ProofOfPayable, type CanonicalPayable } from "@pakta/canonical-model";
import { beforeAll, describe, expect, it } from "vitest";
import { buildProofOfPayable, ProofBuilderError } from "../src/buildProof.js";
import { canonicalHash } from "../src/canonicalHash.js";

const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/demo-workbook");
const now = new Date("2026-09-23T09:00:00Z");

let payables: CanonicalPayable[];
let results: KernelResult[];

beforeAll(async () => {
  const policy = loadPolicyFromYaml(readFileSync(path.join(fixturesDir, "policy.yaml"), "utf-8"));
  const workbookBuffer = readFileSync(path.join(fixturesDir, "demo-workbook.xlsx"));
  ({ payables } = await ingestWorkbook(workbookBuffer, policy));

  results = evaluateBatch(payables, {
    policy,
    now,
    knownInvoiceFingerprints: new Set(["VEN-002|3500.00"]),
    settledInvoiceFingerprints: new Set(),
  });
});

function find(invoiceId: string) {
  const payable = payables.find((p) => p.invoice.invoiceId === invoiceId)!;
  const result = results.find((r) => r.payableId === payable.payableId)!;
  return { payable, result };
}

describe("buildProofOfPayable", () => {
  it("builds a schema-valid ProofOfPayable for the one READY invoice (INV-001)", () => {
    const { payable, result } = find("INV-001");
    const proof = buildProofOfPayable(payable, result, now);

    expect(ProofOfPayable.safeParse(proof).success).toBe(true);
    expect(proof).toMatchObject({
      payable_id: "PAY-INV-001",
      vendor_id: "VEN-001",
      amount: "5000.00",
      asset: "USDC",
      status: "READY",
    });
  });

  it("sets expires_at 48h after `now`", () => {
    const { payable, result } = find("INV-001");
    const proof = buildProofOfPayable(payable, result, now);
    const diffHours = (new Date(proof.expires_at).getTime() - now.getTime()) / (60 * 60 * 1000);
    expect(diffHours).toBe(48);
  });

  it("reproduces a registered proof when its original expiry is retained", () => {
    const { payable, result } = find("INV-001");
    const original = buildProofOfPayable(payable, result, now);
    const resumed = buildProofOfPayable(payable, result, new Date("2026-09-24T12:00:00Z"), {
      expiresAt: new Date(original.expires_at),
    });

    expect(resumed).toEqual(original);
  });

  it("refuses to build a proof for a BLOCKED payable", () => {
    const { payable, result } = find("INV-002");
    expect(result.status).toBe("BLOCKED");
    expect(() => buildProofOfPayable(payable, result, now)).toThrow(ProofBuilderError);
  });

  it("never passes a placeholder label off as a hash", () => {
    // The fixture's sourceHash is the label "sha256:demo-inv-001", not a digest.
    // v1.0 copied it straight into invoice_hash; the settlement gate rejects that.
    const { payable, result } = find("INV-001");
    expect(payable.invoice.sourceHash).toBe("sha256:demo-inv-001");

    const proof = buildProofOfPayable(payable, result, now);
    expect(proof.invoice_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.invoice_hash).toBe(canonicalHash(payable.invoice));
  });

  it("passes a real source digest straight through, with or without a sha256: prefix", () => {
    const { payable, result } = find("INV-001");
    const digest = "9".repeat(64);

    for (const sourceHash of [digest, `sha256:${digest}`]) {
      const withDigest = { ...payable, invoice: { ...payable.invoice, sourceHash } };
      expect(buildProofOfPayable(withDigest, result, now).invoice_hash).toBe(digest);
    }
  });
});

describe("v1.1 compatibility with the settlement gate", () => {
  it("formats expires_at to the second — toISOString's milliseconds were rejected by the adapter", () => {
    const { payable, result } = find("INV-001");
    const proof = buildProofOfPayable(payable, result, new Date("2026-09-23T09:00:00.789Z"));
    expect(proof.expires_at).toBe("2026-09-25T09:00:00Z");
  });

  it("emits every evidence hash as 64 lowercase hex with no prefix", () => {
    const { payable, result } = find("INV-001");
    const proof = buildProofOfPayable(payable, result, now);
    for (const field of ["invoice_hash", "po_hash", "receipt_hash", "approvals_hash"] as const) {
      expect(proof[field], field).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("commits to the receipts, so the proof covers the whole three-way match", () => {
    const { payable, result } = find("INV-001");
    const proof = buildProofOfPayable(payable, result, now);
    expect(proof.receipt_hash).toBe(canonicalHash(payable.receipts));

    const alteredReceipt = { ...payable, receipts: payable.receipts.map((r) => ({ ...r, confirmedQty: 99 })) };
    expect(buildProofOfPayable(alteredReceipt, result, now).receipt_hash).not.toBe(proof.receipt_hash);
  });

  it("carries a real Stellar account as vendor_wallet", () => {
    const { payable, result } = find("INV-001");
    expect(buildProofOfPayable(payable, result, now).vendor_wallet).toBe(
      "GAGCMMI5YDAYYVZDMUOZZXEVS3OSSNKTATYHAFMFCCEISRYZH5F4JZI2",
    );
  });

  it("refuses to emit a proof the gate would reject, instead of failing three services later", () => {
    const { payable, result } = find("INV-001");
    const placeholderWallet = {
      ...payable,
      vendorWallet: { ...payable.vendorWallet!, address: "GA1CD9F3KXQPLMN7R2WZT8VY" },
    };
    expect(() => buildProofOfPayable(placeholderWallet, result, now)).toThrow(/vendor_wallet/);
  });
});

describe("canonicalHash", () => {
  it("is deterministic regardless of key order", () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it("changes when the content changes", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });

  it("is 64 lowercase hex with no prefix", () => {
    expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes Dates, undefined fields and non-integer quantities deterministically", () => {
    const value = { at: new Date("2026-09-23T00:00:00Z"), qty: 1.5, missing: undefined };
    expect(canonicalHash(value)).toBe(canonicalHash({ qty: 1.5, at: new Date("2026-09-23T00:00:00Z") }));
    expect(canonicalHash(value)).not.toBe(canonicalHash({ ...value, qty: 2.5 }));
  });
});
