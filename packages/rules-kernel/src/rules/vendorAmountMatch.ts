import { Decimal } from "decimal.js";
import type { Rule } from "../types.js";

/**
 * §7.3 rule 2: `invoice.amount <= po.remaining_amount + tolerance`.
 *
 * (§7.3 rule 1, `invoice.vendor_id == po.vendor_id`, is enforced at
 * ingestion as a row rejection — see ingestWorkbook.ts. By the time a
 * payable reaches the kernel, vendor/PO already agree.)
 *
 * No PO on the payable means policy already allowed a PO-less invoice at
 * ingestion (`require_po: false`) — nothing to compare against, so this
 * rule passes.
 */
export const vendorAmountMatch: Rule = (payable, context) => {
  const po = payable.purchaseOrder;
  if (!po) return { ok: true };

  const invoiceAmount = new Decimal(payable.invoice.amount);
  const poAmount = new Decimal(po.amount);
  const tolerance = poAmount.mul(context.policy.rules.amount_tolerance_pct).div(100);
  const ceiling = poAmount.plus(tolerance);

  if (invoiceAmount.lte(ceiling)) return { ok: true };

  return {
    ok: false,
    reason: "PO_AMOUNT_MISMATCH",
    message: `Invoice amount ${payable.invoice.amount} exceeds PO ${po.poId} (${po.amount}) plus ${context.policy.rules.amount_tolerance_pct}% tolerance (ceiling ${ceiling.toFixed(2)}).`,
    evidence: {
      poId: po.poId,
      poAmount: po.amount,
      invoiceAmount: payable.invoice.amount,
      toleranceCeiling: ceiling.toFixed(2),
    },
  };
};
