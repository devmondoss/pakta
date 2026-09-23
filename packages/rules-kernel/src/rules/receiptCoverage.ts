import type { Rule } from "../types.js";

/**
 * §7.3 rule 3: `receipt.confirmed_quantity >= invoiced_quantity`.
 *
 * No receipt row at all -> MISSING_RECEIPT (if policy requires one).
 * A receipt exists but falls short of the invoiced quantity -> PARTIAL_RECEIPT.
 * "Invoiced quantity" is tracked on the Receipt row itself (`invoicedQty`)
 * rather than on Invoice — the MVP workbook only totals quantities per PO,
 * it doesn't itemize line quantities on the invoice.
 */
export const receiptCoverage: Rule = (payable, context) => {
  if (payable.receipts.length === 0) {
    if (!context.policy.rules.require_receipt) return { ok: true };
    return {
      ok: false,
      reason: "MISSING_RECEIPT",
      message: `No receipt on file for PO ${payable.purchaseOrder?.poId ?? "(none)"}; delivery not confirmed.`,
      evidence: { poId: payable.purchaseOrder?.poId },
    };
  }

  const trackedReceipts = payable.receipts.filter((r) => r.invoicedQty !== undefined);
  if (trackedReceipts.length === 0) return { ok: true }; // nothing tracked to fall short of

  const totalConfirmed = trackedReceipts.reduce((sum, r) => sum + r.confirmedQty, 0);
  const totalInvoiced = trackedReceipts.reduce((sum, r) => sum + (r.invoicedQty ?? 0), 0);

  if (totalConfirmed >= totalInvoiced) return { ok: true };

  return {
    ok: false,
    reason: "PARTIAL_RECEIPT",
    message: `Confirmed receipt quantity (${totalConfirmed}) is less than invoiced quantity (${totalInvoiced}).`,
    evidence: { totalConfirmed, totalInvoiced },
  };
};
