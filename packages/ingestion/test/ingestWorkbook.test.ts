import { readFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import type { Policy } from "@pakta/canonical-model";
import { describe, expect, it } from "vitest";
import { ingestWorkbook } from "../src/index.js";

// Mirrors fixtures/demo-workbook/policy.yaml exactly (ingestion receives an
// already-parsed Policy; YAML loading is the rules-kernel's job, tested there).
const demoPolicy: Policy = {
  policyVersion: "FIN-4.2",
  rules: {
    require_po: true,
    require_receipt: true,
    amount_tolerance_pct: 2,
    duplicate_detection: true,
    wallet_change_requires_human: true,
    auto_pay_below: "1000.00",
    second_approval_above: "5000.00",
  },
};

const demoWorkbookPath = path.resolve(
  import.meta.dirname,
  "../../../fixtures/demo-workbook/demo-workbook.xlsx",
);

describe("ingestWorkbook against the demo fixture", () => {
  it("ingests exactly 5 payables and rejects nothing", async () => {
    const buffer = readFileSync(demoWorkbookPath);
    const result = await ingestWorkbook(buffer, demoPolicy);

    expect(result.rejectedRows).toEqual([]);
    expect(result.payables).toHaveLength(5);
    expect(result.summary).toEqual({ totalInvoiceRows: 5, ingested: 5, rejected: 0 });
  });

  it("resolves each payable's vendor, PO, receipts and approvals correctly", async () => {
    const buffer = readFileSync(demoWorkbookPath);
    const { payables } = await ingestWorkbook(buffer, demoPolicy);

    const inv001 = payables.find((p) => p.invoice.invoiceId === "INV-001");
    expect(inv001?.vendor.legalName).toBe("CloudData Inc.");
    expect(inv001?.purchaseOrder?.poId).toBe("PO-72881");
    expect(inv001?.receipts).toHaveLength(1);
    expect(inv001?.approvals.length).toBeGreaterThanOrEqual(1);

    const inv005 = payables.find((p) => p.invoice.invoiceId === "INV-005");
    expect(inv005?.receipts).toHaveLength(0); // no RECEIPTS row for PO-73344 — proves MISSING_RECEIPT input reaches the kernel intact
  });

  it("sums to the exact totals from Pakta_Documento_Maestro.md §25", async () => {
    const buffer = readFileSync(demoWorkbookPath);
    const { payables } = await ingestWorkbook(buffer, demoPolicy);
    const total = payables.reduce((sum, p) => sum + Number(p.invoice.amount), 0);
    expect(total).toBeCloseTo(28400.0, 2);
  });
});

describe("ingestWorkbook error handling — reject rows individually, never abort the batch", () => {
  async function buildMalformedWorkbook(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();

    const vendors = wb.addWorksheet("VENDORS");
    vendors.columns = [
      { header: "vendor_id", key: "vendor_id" },
      { header: "legal_name", key: "legal_name" },
      { header: "verification_status", key: "verification_status" },
      { header: "wallet_address", key: "wallet_address" },
      { header: "wallet_attestation_status", key: "wallet_attestation_status" },
      { header: "wallet_version", key: "wallet_version" },
      { header: "wallet_created_at", key: "wallet_created_at" },
    ];
    vendors.addRow({
      vendor_id: "VEN-A", legal_name: "Vendor A", verification_status: "VERIFIED",
      wallet_address: "GAAA", wallet_attestation_status: "ATTESTED", wallet_version: 1, wallet_created_at: "2026-01-01",
    });
    vendors.addRow({
      vendor_id: "VEN-B", legal_name: "Vendor B", verification_status: "VERIFIED",
      wallet_address: "GBBB", wallet_attestation_status: "ATTESTED", wallet_version: 1, wallet_created_at: "2026-01-01",
    });

    const po = wb.addWorksheet("PO");
    po.columns = [
      { header: "po_id", key: "po_id" }, { header: "vendor_id", key: "vendor_id" },
      { header: "amount", key: "amount" }, { header: "status", key: "status" }, { header: "approver_id", key: "approver_id" },
    ];
    po.addRow({ po_id: "PO-A", vendor_id: "VEN-A", amount: "1000.00", status: "OPEN", approver_id: "c" });
    po.addRow({ po_id: "PO-B", vendor_id: "VEN-B", amount: "2000.00", status: "OPEN", approver_id: "c" }); // belongs to VEN-B

    const invoices = wb.addWorksheet("INVOICES");
    invoices.columns = [
      { header: "invoice_id", key: "invoice_id" }, { header: "po_id", key: "po_id" }, { header: "vendor_id", key: "vendor_id" },
      { header: "amount", key: "amount" }, { header: "due_date", key: "due_date" },
      { header: "wallet_address", key: "wallet_address" }, { header: "source_hash", key: "source_hash" },
    ];
    // Row 1: valid.
    invoices.addRow({ invoice_id: "INV-OK", po_id: "PO-A", vendor_id: "VEN-A", amount: "1000.00", due_date: "2026-09-23", wallet_address: "GAAA", source_hash: "sha256:ok" });
    // Row 2: malformed amount ("one thousand" is not a decimal) — must be rejected individually.
    invoices.addRow({ invoice_id: "INV-BAD-AMOUNT", po_id: "PO-A", vendor_id: "VEN-A", amount: "one thousand", due_date: "2026-09-23", wallet_address: "GAAA", source_hash: "sha256:bad" });
    // Row 3: missing vendor_id entirely — must be rejected individually.
    invoices.addRow({ invoice_id: "INV-NO-VENDOR", po_id: "PO-A", vendor_id: "", amount: "500.00", due_date: "2026-09-23", wallet_address: "GAAA", source_hash: "sha256:novendor" });
    // Row 4: invoice claims VEN-A but references PO-B, which actually belongs to VEN-B -> VENDOR_PO_MISMATCH.
    invoices.addRow({ invoice_id: "INV-MISMATCH", po_id: "PO-B", vendor_id: "VEN-A", amount: "500.00", due_date: "2026-09-23", wallet_address: "GAAA", source_hash: "sha256:mismatch" });

    const buffer = await wb.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  it("ingests the one valid row and rejects the three malformed/inconsistent rows individually", async () => {
    const buffer = await buildMalformedWorkbook();
    const result = await ingestWorkbook(buffer, demoPolicy);

    expect(result.payables).toHaveLength(1);
    expect(result.payables[0]?.invoice.invoiceId).toBe("INV-OK");
    expect(result.rejectedRows).toHaveLength(3);

    const byInvoiceId = (id: string) => result.rejectedRows.find((r) => JSON.stringify(r.rawRow).includes(id));
    expect(byInvoiceId("INV-BAD-AMOUNT")?.errors.join(" ")).toMatch(/decimal/i);
    expect(byInvoiceId("INV-NO-VENDOR")).toBeDefined();
    expect(byInvoiceId("INV-MISMATCH")?.errors.join(" ")).toMatch(/VENDOR_PO_MISMATCH/);
  });
});
