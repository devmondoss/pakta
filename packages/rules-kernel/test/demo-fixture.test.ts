import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestWorkbook } from "@pakta/ingestion";
import { beforeAll, describe, expect, it } from "vitest";
import { evaluateBatch } from "../src/kernel.js";
import { loadPolicyFromYaml } from "../src/loadPolicy.js";
import type { KernelResult } from "../src/kernel.js";

/**
 * End-to-end acceptance test for Dev 2's Week 1 slice
 * (Pakta_Division_Trabajo.md's "Definition of done — Fase 1"): run the
 * canonical 5-invoice demo from Pakta_Documento_Maestro.md §17.3/§25 all
 * the way from the .xlsx workbook to kernel results, and check it lands on
 * exactly 1 READY + 4 correctly-typed-and-owned BLOCKED.
 */

const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/demo-workbook");

let results: KernelResult[];
const now = new Date("2026-09-23T09:00:00Z");

beforeAll(async () => {
  const policy = loadPolicyFromYaml(readFileSync(path.join(fixturesDir, "policy.yaml"), "utf-8"));
  const workbookBuffer = readFileSync(path.join(fixturesDir, "demo-workbook.xlsx"));
  const { payables, rejectedRows } = await ingestWorkbook(workbookBuffer, policy);
  expect(rejectedRows).toEqual([]);

  results = evaluateBatch(payables, {
    policy,
    now,
    // Simulates "INV-1994 was already recorded 11 days ago" for Northline
    // Supplies — an external fact the system already knew, not part of
    // this ingested batch (see demo-data.json's note on INV-002).
    knownInvoiceFingerprints: new Set(["VEN-002|3500.00"]),
    settledInvoiceFingerprints: new Set(),
  });
});

function resultFor(invoiceId: string): KernelResult {
  const found = results.find((r) => r.payableId === `PAY-${invoiceId}`);
  if (!found) throw new Error(`no kernel result for ${invoiceId}`);
  return found;
}

describe("the canonical 5-invoice demo", () => {
  it("produces exactly 1 READY and 4 BLOCKED", () => {
    const ready = results.filter((r) => r.status === "READY");
    const blocked = results.filter((r) => r.status === "BLOCKED");
    expect(results).toHaveLength(5);
    expect(ready).toHaveLength(1);
    expect(blocked).toHaveLength(4);
  });

  it("INV-001 is READY", () => {
    expect(resultFor("INV-001").status).toBe("READY");
  });

  it("INV-002 is BLOCKED with DUPLICATE_INVOICE, owned by AP", () => {
    const result = resultFor("INV-002");
    expect(result.status).toBe("BLOCKED");
    if (result.status === "BLOCKED") {
      expect(result.primaryException.reason).toBe("DUPLICATE_INVOICE");
      expect(result.primaryException.ownerRole).toBe("AP");
    }
  });

  it("INV-003 is BLOCKED with PO_AMOUNT_MISMATCH, owned by PROCUREMENT", () => {
    const result = resultFor("INV-003");
    expect(result.status).toBe("BLOCKED");
    if (result.status === "BLOCKED") {
      expect(result.primaryException.reason).toBe("PO_AMOUNT_MISMATCH");
      expect(result.primaryException.ownerRole).toBe("PROCUREMENT");
    }
  });

  it("INV-004 is BLOCKED with VENDOR_WALLET_CHANGED, owned by VENDOR_MASTER, matching §5.3's exact required action", () => {
    const result = resultFor("INV-004");
    expect(result.status).toBe("BLOCKED");
    if (result.status === "BLOCKED") {
      expect(result.primaryException.reason).toBe("VENDOR_WALLET_CHANGED");
      expect(result.primaryException.ownerRole).toBe("VENDOR_MASTER");
      expect(result.primaryException.severity).toBe("CRITICAL");
      // Literal string from Pakta_Documento_Maestro.md §5.3 — a direct spec-conformance check.
      expect(result.primaryException.requiredAction).toBe("REVERIFY_VENDOR_WALLET");
    }
  });

  it("INV-005 is BLOCKED with MISSING_RECEIPT, owned by OPERATIONS", () => {
    const result = resultFor("INV-005");
    expect(result.status).toBe("BLOCKED");
    if (result.status === "BLOCKED") {
      expect(result.primaryException.reason).toBe("MISSING_RECEIPT");
      expect(result.primaryException.ownerRole).toBe("OPERATIONS");
    }
  });

  it("sums match Pakta_Documento_Maestro.md §25 exactly: 28,400 requested, 5,000 ready, 23,400 blocked", async () => {
    const policy = loadPolicyFromYaml(readFileSync(path.join(fixturesDir, "policy.yaml"), "utf-8"));
    const workbookBuffer = readFileSync(path.join(fixturesDir, "demo-workbook.xlsx"));
    const { payables } = await ingestWorkbook(workbookBuffer, policy);

    const amountOf = (invoiceId: string) => Number(payables.find((p) => p.invoice.invoiceId === invoiceId)!.invoice.amount);
    const total = payables.reduce((sum, p) => sum + Number(p.invoice.amount), 0);
    const readyTotal = ["INV-001"].reduce((sum, id) => sum + amountOf(id), 0);
    const blockedTotal = ["INV-002", "INV-003", "INV-004", "INV-005"].reduce((sum, id) => sum + amountOf(id), 0);

    expect(total).toBeCloseTo(28400.0, 2);
    expect(readyTotal).toBeCloseTo(5000.0, 2);
    expect(blockedTotal).toBeCloseTo(23400.0, 2);
  });

  it("is deterministic: evaluating the same payables twice with the same `now` yields identical results", async () => {
    const policy = loadPolicyFromYaml(readFileSync(path.join(fixturesDir, "policy.yaml"), "utf-8"));
    const workbookBuffer = readFileSync(path.join(fixturesDir, "demo-workbook.xlsx"));
    const { payables } = await ingestWorkbook(workbookBuffer, policy);

    const context = {
      policy,
      now,
      knownInvoiceFingerprints: new Set(["VEN-002|3500.00"]),
      settledInvoiceFingerprints: new Set<string>(),
    };

    const run1 = evaluateBatch(payables, context);
    const run2 = evaluateBatch(payables, context);
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});
