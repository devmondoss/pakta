import { invoiceFingerprint, type Rule } from "../types.js";

/**
 * §7.3 rule 4: `invoice_fingerprint NOT IN settled_invoices`.
 *
 * Split into two branches for week 1, since there's no real settlement
 * history yet:
 *  - `settledInvoiceFingerprints` (from Dev 1's `settlements` table, empty
 *    in week 1) -> PAYMENT_ALREADY_SETTLED, a possible replay.
 *  - `knownInvoiceFingerprints` (anything else the system already knows
 *    about — pre-seeded in context for now, will come from a real
 *    invoice-history lookup later) -> DUPLICATE_INVOICE.
 *
 * Fingerprint is deliberately coarse (`vendorId|amount`, see types.ts) for
 * week 1 — good enough to catch "same vendor, same amount, resent" without
 * needing fuzzy invoice-number matching yet.
 */
export const duplicateCheck: Rule = (payable, context) => {
  if (!context.policy.rules.duplicate_detection) return { ok: true };

  const fingerprint = invoiceFingerprint(payable);

  if (context.settledInvoiceFingerprints.has(fingerprint)) {
    return {
      ok: false,
      reason: "PAYMENT_ALREADY_SETTLED",
      message: `An invoice matching this vendor and amount was already settled.`,
      evidence: { fingerprint },
    };
  }

  if (context.knownInvoiceFingerprints.has(fingerprint)) {
    return {
      ok: false,
      reason: "DUPLICATE_INVOICE",
      message: `An invoice matching this vendor and amount was already recorded.`,
      evidence: { fingerprint },
    };
  }

  return { ok: true };
};
