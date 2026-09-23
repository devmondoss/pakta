import type { Rule } from "../types.js";

/**
 * §7.3 rule 8: `payable.expiry > now`.
 *
 * Structurally present but a no-op pass in week 1: a freshly-ingested
 * payable has no `expiresAt` yet (that only gets set once a Proof-of-Payable
 * exists — Proof-of-Payable Builder is a week-3 task).
 */
export const proofExpiry: Rule = (payable, context) => {
  if (!payable.expiresAt) return { ok: true };
  if (payable.expiresAt > context.now) return { ok: true };

  return {
    ok: false,
    reason: "PROOF_EXPIRED",
    message: `Payable expired at ${payable.expiresAt.toISOString()}.`,
    evidence: { expiresAt: payable.expiresAt.toISOString(), now: context.now.toISOString() },
  };
};
