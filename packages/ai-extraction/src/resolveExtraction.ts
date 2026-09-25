import {
  CanonicalPayable,
  type Approval,
  type PurchaseOrder,
  type Receipt,
  type Vendor,
  type VendorWallet,
} from "@pakta/canonical-model";
import type { InvoiceExtraction } from "./schema.js";

export type KnownSources = {
  vendors: Vendor[];
  vendorWallets: VendorWallet[];
  purchaseOrders: PurchaseOrder[];
  receipts: Receipt[];
  approvals: Approval[];
};

export type ResolvedExtraction =
  | { status: "CANDIDATE"; payable: CanonicalPayable }
  | { status: "NEEDS_REVIEW"; reason: string };

const DEFAULT_MIN_CONFIDENCE = 0.7;

/**
 * HU-D2-12's guardrail. This never trusts the AI for anything except the
 * invoice's own printed values (amount, due date, invoice id, wallet) —
 * vendor identity, PO terms, receipts, approvals and wallet attestation
 * always come from `sources`, the system's own records, exactly like
 * `ingestWorkbook` does for spreadsheet rows. A hallucinated vendor or PO
 * simply fails to resolve; a hallucinated amount or wallet resolves fine
 * here but gets caught downstream by the real kernel's existing rules
 * (`vendorAmountMatch`, `walletAttestation`) once the candidate is
 * evaluated — this function does not re-implement those checks.
 */
export function resolveExtraction(
  extraction: InvoiceExtraction,
  sources: KnownSources,
  opts: { policyVersion: string; minConfidence?: number },
): ResolvedExtraction {
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

  const requiredFields = [
    extraction.vendorName,
    extraction.invoiceId,
    extraction.amount,
    extraction.dueDate,
  ];
  const lowConfidenceField = requiredFields.find((f) => f.confidence < minConfidence);
  if (lowConfidenceField) {
    return {
      status: "NEEDS_REVIEW",
      reason: `LOW_CONFIDENCE: "${lowConfidenceField.value}" (${lowConfidenceField.confidence}) is below the ${minConfidence} threshold`,
    };
  }

  const vendor = sources.vendors.find(
    (v) => v.legalName.toLowerCase() === extraction.vendorName.value.toLowerCase(),
  );
  if (!vendor) {
    return { status: "NEEDS_REVIEW", reason: `VENDOR_NOT_FOUND: no vendor named "${extraction.vendorName.value}"` };
  }

  let po: PurchaseOrder | undefined;
  if (extraction.poReference && extraction.poReference.confidence >= minConfidence) {
    const found = sources.purchaseOrders.find(
      (p) => p.poId.toLowerCase() === extraction.poReference!.value.toLowerCase(),
    );
    if (!found) {
      return { status: "NEEDS_REVIEW", reason: `PO_NOT_FOUND: no PO "${extraction.poReference.value}"` };
    }
    if (found.vendorId !== vendor.vendorId) {
      return {
        status: "NEEDS_REVIEW",
        reason: `VENDOR_PO_MISMATCH: PO "${found.poId}" belongs to vendor "${found.vendorId}", not "${vendor.vendorId}"`,
      };
    }
    po = found;
  }

  const vendorWallet = sources.vendorWallets.find((w) => w.vendorId === vendor.vendorId);
  const walletAddress = extraction.walletAddress?.value ?? vendorWallet?.address;
  if (!walletAddress) {
    return {
      status: "NEEDS_REVIEW",
      reason: `MISSING_WALLET: invoice has no wallet and vendor "${vendor.vendorId}" has no attested wallet on file`,
    };
  }

  const receipts = po ? sources.receipts.filter((r) => r.poId === po!.poId) : [];
  const approvals = sources.approvals.filter(
    (a) => a.objectId === po?.poId || a.objectId === extraction.invoiceId.value,
  );

  const candidate = {
    payableId: `PAY-${extraction.invoiceId.value}`,
    invoice: {
      invoiceId: extraction.invoiceId.value,
      poId: po?.poId,
      vendorId: vendor.vendorId,
      amount: extraction.amount.value,
      dueDate: extraction.dueDate.value,
      walletAddress,
      sourceHash: `sha256:ai-extracted-${extraction.invoiceId.value}`,
    },
    purchaseOrder: po,
    vendor,
    vendorWallet,
    receipts,
    approvals,
    policyVersion: opts.policyVersion,
  };

  const parsed = CanonicalPayable.safeParse(candidate);
  if (!parsed.success) {
    return {
      status: "NEEDS_REVIEW",
      reason: `CANONICAL_MODEL_INVALID: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    };
  }

  return { status: "CANDIDATE", payable: parsed.data };
}
