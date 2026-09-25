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

  it("refuses to build a proof for a BLOCKED payable", () => {
    const { payable, result } = find("INV-002");
    expect(result.status).toBe("BLOCKED");
    expect(() => buildProofOfPayable(payable, result, now)).toThrow(ProofBuilderError);
  });

  it("produces the same invoice_hash as the payable's own sourceHash (pass-through, not re-derived)", () => {
    const { payable, result } = find("INV-001");
    const proof = buildProofOfPayable(payable, result, now);
    expect(proof.invoice_hash).toBe(payable.invoice.sourceHash);
  });
});

describe("canonicalHash", () => {
  it("is deterministic regardless of key order", () => {
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
  });

  it("changes when the content changes", () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }));
  });
});
