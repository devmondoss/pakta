import { z } from "zod";
import type ExcelJS from "exceljs";

/**
 * Raw-row schemas are deliberately looser than the Canonical Payable Model
 * schemas in @pakta/canonical-model: a spreadsheet cell can hand back a
 * number, a string, or (for dates) a Date object depending on how the user
 * formatted the column, and we coerce here before anything reaches the
 * stricter canonical types.
 */

const decimalLike = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v.toFixed(2) : v.trim()))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "must resolve to a plain decimal, e.g. \"5000.00\"");

const trimmedString = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => v.length > 0, "must not be empty");

const dateLike = z.union([z.string(), z.date()]).transform((v) => (v instanceof Date ? v : v.trim()));

export const VendorRow = z.object({
  vendor_id: trimmedString,
  legal_name: trimmedString,
  verification_status: z.enum(["UNVERIFIED", "VERIFIED", "SUSPENDED"]),
  wallet_address: trimmedString,
  wallet_attestation_status: z.enum(["ATTESTED", "UNATTESTED"]),
  wallet_version: z.coerce.number().int().positive(),
  wallet_created_at: dateLike,
});
export type VendorRow = z.infer<typeof VendorRow>;

export const PoRow = z.object({
  po_id: trimmedString,
  vendor_id: trimmedString,
  amount: decimalLike,
  status: z.enum(["OPEN", "CLOSED", "CANCELLED"]),
  approver_id: trimmedString.optional(),
});
export type PoRow = z.infer<typeof PoRow>;

export const InvoiceRow = z.object({
  invoice_id: trimmedString,
  po_id: trimmedString.optional(),
  vendor_id: trimmedString,
  amount: decimalLike,
  due_date: dateLike,
  wallet_address: trimmedString,
  source_hash: trimmedString,
});
export type InvoiceRow = z.infer<typeof InvoiceRow>;

export const ReceiptRow = z.object({
  po_id: trimmedString,
  confirmed_qty: z.coerce.number().nonnegative(),
  invoiced_qty: z.coerce.number().positive().optional(),
  confirmed_by: trimmedString,
  confirmed_at: dateLike,
});
export type ReceiptRow = z.infer<typeof ReceiptRow>;

export const ApprovalRow = z.object({
  object_type: z.enum(["PO", "INVOICE", "PAYABLE"]),
  object_id: trimmedString,
  policy_version: trimmedString,
  approver_id: trimmedString,
  timestamp: dateLike,
});
export type ApprovalRow = z.infer<typeof ApprovalRow>;

/** One rejected spreadsheet row, kept with enough context to fix it and re-upload. */
export type RejectedRow = {
  sheet: "VENDORS" | "PO" | "INVOICES" | "RECEIPTS" | "APPROVALS";
  rowNumber: number;
  errors: string[];
  rawRow: Record<string, unknown>;
};

/** Reads a worksheet's header row + data rows into plain objects keyed by header. */
export function readSheetRows(sheet: ExcelJS.Worksheet | undefined): { rowNumber: number; raw: Record<string, unknown> }[] {
  if (!sheet) return [];
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? "").trim();
  });

  const rows: { rowNumber: number; raw: Record<string, unknown> }[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const raw: Record<string, unknown> = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) raw[header] = cell.value;
    });
    if (Object.values(raw).some((v) => v !== null && v !== undefined && v !== "")) {
      rows.push({ rowNumber, raw });
    }
  });
  return rows;
}

/** Runs `schema.safeParse` over every row; valid rows and rejects are kept separate, batch never aborts. */
export function parseRows<T>(
  sheetName: RejectedRow["sheet"],
  rows: { rowNumber: number; raw: Record<string, unknown> }[],
  schema: z.ZodType<T>,
): { valid: T[]; rejected: RejectedRow[] } {
  const valid: T[] = [];
  const rejected: RejectedRow[] = [];
  for (const { rowNumber, raw } of rows) {
    const result = schema.safeParse(raw);
    if (result.success) {
      valid.push(result.data);
    } else {
      rejected.push({
        sheet: sheetName,
        rowNumber,
        errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        rawRow: raw,
      });
    }
  }
  return { valid, rejected };
}
