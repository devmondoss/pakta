/**
 * Generates demo-workbook.xlsx from demo-data.json — the reviewable source
 * of truth. Run with `pnpm build:fixture` and commit the resulting .xlsx.
 *
 * Column headers here are Pakta's canonical workbook schema (extends the
 * flat field lists in Pakta_Documento_Maestro.md §7.0 with the wallet
 * attestation fields the Vendor Master module needs).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ExcelJS from "exceljs";

const here = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(path.join(here, "demo-data.json"), "utf-8"));

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: { header: string; key: string }[],
  rows: Record<string, unknown>[],
) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  for (const row of rows) sheet.addRow(row);
}

async function main() {
  const workbook = new ExcelJS.Workbook();

  addSheet(
    workbook,
    "VENDORS",
    [
      { header: "vendor_id", key: "vendor_id" },
      { header: "legal_name", key: "legal_name" },
      { header: "verification_status", key: "verification_status" },
      { header: "wallet_address", key: "wallet_address" },
      { header: "wallet_attestation_status", key: "wallet_attestation_status" },
      { header: "wallet_version", key: "wallet_version" },
      { header: "wallet_created_at", key: "wallet_created_at" },
    ],
    data.vendors.map((v: any) => ({
      vendor_id: v.vendorId,
      legal_name: v.legalName,
      verification_status: v.verificationStatus,
      wallet_address: v.wallet.address,
      wallet_attestation_status: v.wallet.attestationStatus,
      wallet_version: v.wallet.version,
      wallet_created_at: v.wallet.createdAt,
    })),
  );

  addSheet(
    workbook,
    "PO",
    [
      { header: "po_id", key: "po_id" },
      { header: "vendor_id", key: "vendor_id" },
      { header: "amount", key: "amount" },
      { header: "status", key: "status" },
      { header: "approver_id", key: "approver_id" },
    ],
    data.purchaseOrders.map((po: any) => ({
      po_id: po.poId,
      vendor_id: po.vendorId,
      amount: po.amount,
      status: po.status,
      approver_id: po.approverId,
    })),
  );

  addSheet(
    workbook,
    "INVOICES",
    [
      { header: "invoice_id", key: "invoice_id" },
      { header: "po_id", key: "po_id" },
      { header: "vendor_id", key: "vendor_id" },
      { header: "amount", key: "amount" },
      { header: "due_date", key: "due_date" },
      { header: "wallet_address", key: "wallet_address" },
      { header: "source_hash", key: "source_hash" },
    ],
    data.invoices.map((inv: any) => ({
      invoice_id: inv.invoiceId,
      po_id: inv.poId,
      vendor_id: inv.vendorId,
      amount: inv.amount,
      due_date: inv.dueDate,
      wallet_address: inv.walletAddress,
      source_hash: inv.sourceHash,
    })),
  );

  addSheet(
    workbook,
    "RECEIPTS",
    [
      { header: "po_id", key: "po_id" },
      { header: "confirmed_qty", key: "confirmed_qty" },
      { header: "invoiced_qty", key: "invoiced_qty" },
      { header: "confirmed_by", key: "confirmed_by" },
      { header: "confirmed_at", key: "confirmed_at" },
    ],
    data.receipts.map((r: any) => ({
      po_id: r.poId,
      confirmed_qty: r.confirmedQty,
      invoiced_qty: r.invoicedQty,
      confirmed_by: r.confirmedBy,
      confirmed_at: r.confirmedAt,
    })),
  );

  addSheet(
    workbook,
    "APPROVALS",
    [
      { header: "object_type", key: "object_type" },
      { header: "object_id", key: "object_id" },
      { header: "policy_version", key: "policy_version" },
      { header: "approver_id", key: "approver_id" },
      { header: "timestamp", key: "timestamp" },
    ],
    data.approvals.map((a: any) => ({
      object_type: a.objectType,
      object_id: a.objectId,
      policy_version: a.policyVersion,
      approver_id: a.approverId,
      timestamp: a.timestamp,
    })),
  );

  const outPath = path.join(here, "demo-workbook.xlsx");
  await workbook.xlsx.writeFile(outPath);
  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
