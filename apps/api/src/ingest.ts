import { readFileSync } from "node:fs";
import path from "node:path";
import {
  extractInvoiceFromPdf,
  resolveExtraction,
  type InvoiceExtraction,
  type InvoiceExtractor,
  type KnownSources,
} from "@pakta/ai-extraction";
import {
  addKnownFingerprint,
  countPayables,
  getReceipt,
  getWallet,
  listPayables,
  seedReceiptIfAbsent,
  seedWalletIfAbsent,
  upsertPayable,
  type Db,
} from "@pakta/db";
import { ingestWorkbook, type RejectedRow } from "@pakta/ingestion";
import { loadPolicyFromYaml } from "@pakta/rules-kernel";
import type { Policy } from "@pakta/canonical-model";

const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/demo-workbook");

/**
 * The policy config the kernel evaluates against — a small YAML file, not
 * invoice data. Real payables come from real uploads (`POST /ingest`);
 * this is just "what are the current business rules," which nobody
 * uploads per-invoice.
 */
let policyCache: Promise<Policy> | undefined;
export function loadPolicy(): Promise<Policy> {
  policyCache ??= Promise.resolve(loadPolicyFromYaml(readFileSync(path.join(fixturesDir, "policy.yaml"), "utf-8")));
  return policyCache;
}

export type IngestOutcome = { ingested: number; rejectedRows: RejectedRow[] };

/**
 * The one real ingestion path — used by `POST /ingest` for an actual
 * upload, and by `seedIfEmpty` below for the demo's starting data. Same
 * code either way: parses the workbook, persists every resulting payable
 * to `@pakta/db`, and seeds any vendor wallets/receipts it carried that
 * aren't on file yet. Nothing about a payable's *evaluation* (READY vs
 * BLOCKED) happens here — that's computed live from what's actually in
 * the DB, every time `GET /payables` is called.
 */
export async function ingestAndPersist(db: Db, workbookBuffer: Buffer): Promise<IngestOutcome> {
  const policy = await loadPolicy();
  const { payables, rejectedRows } = await ingestWorkbook(workbookBuffer, policy);

  const now = new Date();
  for (const payable of payables) {
    await upsertPayable(db, payable, now);
    if (payable.vendorWallet) await seedWalletIfAbsent(db, payable.vendorWallet);
    for (const receipt of payable.receipts) await seedReceiptIfAbsent(db, receipt);
  }

  return { ingested: payables.length, rejectedRows };
}

export type PdfIngestOutcome = {
  extraction: InvoiceExtraction;
  status: "CANDIDATE" | "NEEDS_REVIEW";
  payableId?: string;
  reason?: string;
};

/**
 * The system's own records, for `resolveExtraction` to match an AI
 * extraction against — built from what's already persisted (every
 * ingested payable carries its vendor, PO, receipts and approvals), with
 * wallets and receipts read live from the DB so a re-attested address or
 * a newly confirmed receipt wins over the copy stored on the payable.
 */
async function knownSources(db: Db): Promise<KnownSources> {
  const payables = await listPayables(db);
  const unique = <T>(items: T[], key: (item: T) => string) => [...new Map(items.map((i) => [key(i), i])).values()];

  const vendors = unique(payables.map((p) => p.vendor), (v) => v.vendorId);
  const vendorWallets = (await Promise.all(vendors.map((v) => getWallet(db, v.vendorId)))).filter((w) => w !== undefined);

  const purchaseOrders = unique(payables.flatMap((p) => (p.purchaseOrder ? [p.purchaseOrder] : [])), (po) => po.poId);
  const receipts = (await Promise.all(purchaseOrders.map((po) => getReceipt(db, po.poId)))).filter((r) => r !== undefined);

  return {
    vendors,
    vendorWallets,
    purchaseOrders,
    receipts,
    approvals: unique(payables.flatMap((p) => p.approvals), (a) => `${a.objectType}|${a.objectId}|${a.approverId}`),
  };
}

/**
 * The PDF half of `POST /ingest`: the AI reads the invoice, and
 * `resolveExtraction` decides whether it matches a vendor/PO the system
 * already knows. Only a CANDIDATE is persisted — a NEEDS_REVIEW comes
 * back with the extraction and the reason, so a human can see exactly
 * what the AI read and why it wasn't trusted.
 */
export async function ingestPdfAndPersist(
  db: Db,
  pdfBuffer: Buffer,
  extractor: InvoiceExtractor,
): Promise<PdfIngestOutcome> {
  const policy = await loadPolicy();
  const extraction = await extractInvoiceFromPdf(pdfBuffer, { extractor });
  const resolved = resolveExtraction(extraction, await knownSources(db), { policyVersion: policy.policyVersion });

  if (resolved.status === "NEEDS_REVIEW") {
    return { extraction, status: "NEEDS_REVIEW", reason: resolved.reason };
  }

  await upsertPayable(db, resolved.payable, new Date());
  return { extraction, status: "CANDIDATE", payableId: resolved.payable.payableId };
}

/**
 * Boot-time only: if the DB has never been ingested into, load the demo
 * workbook through the exact same path a real upload takes. After this
 * runs once, the table is ordinary persisted data — this never runs
 * again once anything exists, so it never clobbers a real upload.
 */
export async function seedIfEmpty(db: Db): Promise<void> {
  if ((await countPayables(db)) > 0) return;
  const workbookBuffer = readFileSync(path.join(fixturesDir, "demo-workbook.xlsx"));
  await ingestAndPersist(db, workbookBuffer);

  // The one external fact the canonical demo depends on (§25 maestro):
  // INV-1994 for Northline Supplies was already recorded 11 days before
  // the demo batch — not something ingestion itself would ever produce,
  // it's a fact about invoice history predating this workbook.
  await addKnownFingerprint(db, "VEN-002|3500.00", "INV-1994, recorded 11 days before the demo batch");
}
