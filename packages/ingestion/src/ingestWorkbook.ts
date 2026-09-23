import { Readable } from "node:stream";
import ExcelJS from "exceljs";
import { CanonicalPayable } from "@pakta/canonical-model";
import type { CanonicalPayable as CanonicalPayableType, Policy } from "@pakta/canonical-model";
import {
  ApprovalRow,
  InvoiceRow,
  PoRow,
  ReceiptRow,
  VendorRow,
  parseRows,
  readSheetRows,
  type RejectedRow,
} from "./sheetParsers.js";

export type IngestionResult = {
  payables: CanonicalPayableType[];
  rejectedRows: RejectedRow[];
  summary: {
    totalInvoiceRows: number;
    ingested: number;
    rejected: number;
  };
};

function reject(rejectedRows: RejectedRow[], sheet: RejectedRow["sheet"], rowNumber: number, rawRow: Record<string, unknown>, error: string) {
  rejectedRows.push({ sheet, rowNumber, errors: [error], rawRow });
}

/**
 * Turns a parsed ExcelJS workbook into the Canonical Payable Model.
 *
 * A malformed row is rejected individually (kept in `rejectedRows` with why
 * and the raw data) — the batch never aborts. This matches the product's
 * "don't punish messy spreadsheets" posture (Pakta_Documento_Maestro.md
 * §4.2): one bad cell in RECEIPTS should never take down the other four
 * invoices next to it.
 *
 * §7.3 rule 1 (`invoice.vendor_id == po.vendor_id`) is enforced HERE as a
 * row rejection (`VENDOR_PO_MISMATCH`), not as a kernel exception — none of
 * the 11 reason codes in §10 describes "PO belongs to a different vendor";
 * it's almost always a data-entry typo, not a business state with an
 * owner/resolution workflow. Revisit with product if that changes.
 */
export async function ingestWorkbook(buffer: Buffer, policy: Policy): Promise<IngestionResult> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's bundled types predate @types/node's stricter Buffer<ArrayBufferLike> generic;
  // this is a known type-only mismatch, not a runtime one — Buffer works fine here.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return ingestLoadedWorkbook(workbook, policy);
}

/** A single CSV file is treated as one sheet — pass the sheet it represents (e.g. "INVOICES"). */
export async function ingestCsv(buffer: Buffer, sheetName: string, policy: Policy): Promise<IngestionResult> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = await workbook.csv.read(Readable.from(buffer));
  worksheet.name = sheetName;
  return ingestLoadedWorkbook(workbook, policy);
}

function ingestLoadedWorkbook(workbook: ExcelJS.Workbook, policy: Policy): IngestionResult {
  const rejectedRows: RejectedRow[] = [];

  const vendorRows = parseRows("VENDORS", readSheetRows(workbook.getWorksheet("VENDORS")), VendorRow);
  const poRows = parseRows("PO", readSheetRows(workbook.getWorksheet("PO")), PoRow);
  const invoiceRows = parseRows("INVOICES", readSheetRows(workbook.getWorksheet("INVOICES")), InvoiceRow);
  const receiptRows = parseRows("RECEIPTS", readSheetRows(workbook.getWorksheet("RECEIPTS")), ReceiptRow);
  const approvalRows = parseRows("APPROVALS", readSheetRows(workbook.getWorksheet("APPROVALS")), ApprovalRow);

  rejectedRows.push(
    ...vendorRows.rejected,
    ...poRows.rejected,
    ...invoiceRows.rejected,
    ...receiptRows.rejected,
    ...approvalRows.rejected,
  );

  const vendorsById = new Map(vendorRows.valid.map((v) => [v.vendor_id, v]));
  const posById = new Map(poRows.valid.map((p) => [p.po_id, p]));
  const receiptsByPoId = new Map<string, ReceiptRow[]>();
  for (const r of receiptRows.valid) {
    const list = receiptsByPoId.get(r.po_id) ?? [];
    list.push(r);
    receiptsByPoId.set(r.po_id, list);
  }
  const approvalsByObjectId = new Map<string, ApprovalRow[]>();
  for (const a of approvalRows.valid) {
    const list = approvalsByObjectId.get(a.object_id) ?? [];
    list.push(a);
    approvalsByObjectId.set(a.object_id, list);
  }

  const payables: CanonicalPayableType[] = [];

  for (const { rowNumber, raw } of readSheetRows(workbook.getWorksheet("INVOICES"))) {
    const invoiceResult = InvoiceRow.safeParse(raw);
    if (!invoiceResult.success) continue; // already recorded in invoiceRows.rejected above
    const invoice = invoiceResult.data;

    const vendor = vendorsById.get(invoice.vendor_id);
    if (!vendor) {
      reject(rejectedRows, "INVOICES", rowNumber, raw, `VENDOR_NOT_FOUND: no vendor "${invoice.vendor_id}" in VENDORS sheet`);
      continue;
    }

    let po: PoRowResolved | undefined;
    if (invoice.po_id) {
      const found = posById.get(invoice.po_id);
      if (!found) {
        reject(rejectedRows, "INVOICES", rowNumber, raw, `PO_NOT_FOUND: no PO "${invoice.po_id}" in PO sheet`);
        continue;
      }
      if (found.vendor_id !== invoice.vendor_id) {
        reject(
          rejectedRows,
          "INVOICES",
          rowNumber,
          raw,
          `VENDOR_PO_MISMATCH: invoice vendor "${invoice.vendor_id}" does not match PO "${invoice.po_id}" vendor "${found.vendor_id}"`,
        );
        continue;
      }
      po = found;
    } else if (policy.rules.require_po) {
      reject(rejectedRows, "INVOICES", rowNumber, raw, "PO_NOT_FOUND: policy.require_po is true but invoice has no po_id");
      continue;
    }

    const receipts = po ? (receiptsByPoId.get(po.po_id) ?? []) : [];
    const approvals = [
      ...(po ? (approvalsByObjectId.get(po.po_id) ?? []) : []),
      ...(approvalsByObjectId.get(invoice.invoice_id) ?? []),
    ];

    const candidate = {
      payableId: `PAY-${invoice.invoice_id}`,
      invoice: {
        invoiceId: invoice.invoice_id,
        poId: invoice.po_id,
        vendorId: invoice.vendor_id,
        amount: invoice.amount,
        dueDate: invoice.due_date,
        walletAddress: invoice.wallet_address,
        sourceHash: invoice.source_hash,
      },
      purchaseOrder: po
        ? {
            poId: po.po_id,
            vendorId: po.vendor_id,
            amount: po.amount,
            status: po.status,
            approverId: po.approver_id,
          }
        : undefined,
      vendor: {
        vendorId: vendor.vendor_id,
        legalName: vendor.legal_name,
        verificationStatus: vendor.verification_status,
      },
      vendorWallet: {
        vendorId: vendor.vendor_id,
        address: vendor.wallet_address,
        attestationStatus: vendor.wallet_attestation_status,
        version: vendor.wallet_version,
        createdAt: vendor.wallet_created_at,
      },
      receipts: receipts.map((r) => ({
        poId: r.po_id,
        confirmedQty: r.confirmed_qty,
        invoicedQty: r.invoiced_qty,
        confirmedBy: r.confirmed_by,
        confirmedAt: r.confirmed_at,
      })),
      approvals: approvals.map((a) => ({
        objectType: a.object_type,
        objectId: a.object_id,
        policyVersion: a.policy_version,
        approverId: a.approver_id,
        timestamp: a.timestamp,
      })),
      policyVersion: policy.policyVersion,
    };

    const parsed = CanonicalPayable.safeParse(candidate);
    if (!parsed.success) {
      reject(
        rejectedRows,
        "INVOICES",
        rowNumber,
        raw,
        `CANONICAL_MODEL_INVALID: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
      );
      continue;
    }
    payables.push(parsed.data);
  }

  const totalInvoiceRows = readSheetRows(workbook.getWorksheet("INVOICES")).length;
  return {
    payables,
    rejectedRows,
    summary: {
      totalInvoiceRows,
      ingested: payables.length,
      rejected: rejectedRows.filter((r) => r.sheet === "INVOICES").length,
    },
  };
}

type PoRowResolved = ReturnType<typeof PoRow.parse>;
