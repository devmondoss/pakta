import type { Rule } from "../types.js";

/**
 * §7.3 rule 7: `budget_available >= amount`.
 *
 * Structurally present but a no-op pass in week 1: `CanonicalPayable` has
 * no cost-center field yet, and no BUDGETS sheet/source feeds
 * `context.budgetsByCostCenter`. Wired for real once both exist — kernel
 * logic itself won't need to change, only the ingestion side and this
 * rule's early-return.
 */
export const budgetAvailable: Rule = (_payable, context) => {
  if (!context.budgetsByCostCenter || context.budgetsByCostCenter.size === 0) {
    return { ok: true };
  }
  // No cost-center field on CanonicalPayable yet — nothing to look up against.
  return { ok: true };
};
