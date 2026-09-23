import type { CanonicalPayable, ExceptionReasonCode, Policy } from "@pakta/canonical-model";

export type RuleContext = {
  policy: Policy;
  /** Injected, never `Date.now()` inside a rule — keeps evaluation deterministic and testable. */
  now: Date;
  /** Fingerprints (`vendorId|amount`) already known to the system from outside this batch — e.g. a prior invoice recorded days ago. */
  knownInvoiceFingerprints: ReadonlySet<string>;
  /** Fingerprints confirmed settled on-chain (from Dev 1's `settlements` table). Empty in week 1 — no settlement history exists yet. */
  settledInvoiceFingerprints: ReadonlySet<string>;
  /** Decimal-string budget remaining per cost center. Absent/empty in week 1 — no BUDGETS source exists yet. */
  budgetsByCostCenter?: ReadonlyMap<string, string>;
};

export type RuleResult =
  | { ok: true }
  | { ok: false; reason: ExceptionReasonCode; message: string; evidence?: Record<string, unknown> };

export type Rule = (payable: CanonicalPayable, context: RuleContext) => RuleResult;

/** `vendorId|amount` — deliberately coarse for week 1 (see duplicateCheck.ts). */
export function invoiceFingerprint(payable: CanonicalPayable): string {
  return `${payable.invoice.vendorId}|${payable.invoice.amount}`;
}
