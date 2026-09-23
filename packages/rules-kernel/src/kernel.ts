import type { CanonicalPayable, Exception } from "@pakta/canonical-model";
import { REASON_CODE_METADATA } from "./reasonCodeMetadata.js";
import { approvalThreshold } from "./rules/approvalThreshold.js";
import { budgetAvailable } from "./rules/budgetAvailable.js";
import { duplicateCheck } from "./rules/duplicateCheck.js";
import { proofExpiry } from "./rules/proofExpiry.js";
import { receiptCoverage } from "./rules/receiptCoverage.js";
import { vendorAmountMatch } from "./rules/vendorAmountMatch.js";
import { walletAttestation } from "./rules/walletAttestation.js";
import { invoiceFingerprint, type Rule, type RuleContext } from "./types.js";

/** All 8 rules from §7.3 (rule 1 lives in ingestion — see ingestWorkbook.ts). Order matters as a severity tie-breaker for `primaryException`. */
const RULES: Rule[] = [
  duplicateCheck, // CRITICAL-leaning reasons first
  walletAttestation,
  vendorAmountMatch,
  approvalThreshold,
  receiptCoverage,
  budgetAvailable,
  proofExpiry,
];

const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

export type KernelResult =
  | { status: "READY"; payableId: string; policyVersion: string }
  | { status: "BLOCKED"; payableId: string; exceptions: Exception[]; primaryException: Exception };

/** Runs all 8 rules against one payable (not fail-fast) and returns READY or every exception found. */
export function evaluatePayable(payable: CanonicalPayable, context: RuleContext): KernelResult {
  const exceptions: Exception[] = [];

  for (const rule of RULES) {
    const result = rule(payable, context);
    if (result.ok) continue;

    const meta = REASON_CODE_METADATA[result.reason];
    exceptions.push({
      payableId: payable.payableId,
      status: "BLOCKED",
      reason: result.reason,
      message: result.message,
      severity: meta.severity,
      ownerRole: meta.ownerRole,
      requiredAction: meta.requiredAction,
      evidence: result.evidence,
      autoRevalidate: meta.autoRevalidate,
      policyVersion: context.policy.policyVersion,
    });
  }

  if (exceptions.length === 0) {
    return { status: "READY", payableId: payable.payableId, policyVersion: context.policy.policyVersion };
  }

  const primaryException = [...exceptions].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  )[0]!;

  return { status: "BLOCKED", payableId: payable.payableId, exceptions, primaryException };
}

/**
 * Evaluates a batch: computes in-batch fingerprint collisions (a fingerprint
 * appearing on more than one payable in the same batch is itself a
 * duplicate signal) unioned with `context.knownInvoiceFingerprints`, then
 * evaluates each payable independently.
 */
export function evaluateBatch(
  payables: CanonicalPayable[],
  context: Omit<RuleContext, "knownInvoiceFingerprints"> & { knownInvoiceFingerprints?: ReadonlySet<string> },
): KernelResult[] {
  const seen = new Set<string>();
  const batchCollisions = new Set<string>();
  for (const p of payables) {
    const fp = invoiceFingerprint(p);
    if (seen.has(fp)) batchCollisions.add(fp);
    seen.add(fp);
  }

  const knownInvoiceFingerprints = new Set([
    ...(context.knownInvoiceFingerprints ?? []),
    ...batchCollisions,
  ]);

  return payables.map((payable) => evaluatePayable(payable, { ...context, knownInvoiceFingerprints }));
}
