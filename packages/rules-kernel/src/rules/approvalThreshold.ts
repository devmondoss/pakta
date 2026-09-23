import { Decimal } from "decimal.js";
import type { Rule } from "../types.js";

/**
 * §7.3 rule 6: `approval_threshold_satisfied == true`.
 *
 * Baseline: at least one approval on file. Above
 * `policy.rules.second_approval_above`, a second approval is required
 * (two-person rule for larger amounts — matches §11.3's SME guidance:
 * "dos-person approval solo por encima de un threshold").
 */
export const approvalThreshold: Rule = (payable, context) => {
  const amount = new Decimal(payable.invoice.amount);
  const secondApprovalThreshold = new Decimal(context.policy.rules.second_approval_above);
  const requiredApprovals = amount.gt(secondApprovalThreshold) ? 2 : 1;

  if (payable.approvals.length < requiredApprovals) {
    return {
      ok: false,
      reason: "APPROVAL_MISSING",
      message: `Requires ${requiredApprovals} approval(s) at this amount; only ${payable.approvals.length} on file.`,
      evidence: { requiredApprovals, approvalsOnFile: payable.approvals.length },
    };
  }

  return { ok: true };
};
