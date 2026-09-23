import { describe, expect, it } from "vitest";
import { budgetAvailable } from "../../src/rules/budgetAvailable.js";
import { proofExpiry } from "../../src/rules/proofExpiry.js";
import { buildContext, buildPayable } from "../helpers.js";

/**
 * §7.3 rules 7 and 8 are real, tested functions from day one — they just
 * can't fail against week-1 data because nothing feeds the inputs that
 * would make them fail yet (a BUDGETS source, an existing proof/expiry).
 * These tests document that as a deliberate no-op, not an oversight.
 */
describe("budgetAvailable (structural no-op in week 1)", () => {
  it("passes when no budget source is wired", () => {
    expect(budgetAvailable(buildPayable(), buildContext())).toEqual({ ok: true });
  });

  it("still passes even with a budgetsByCostCenter map present, since payables don't carry a cost center yet", () => {
    const context = buildContext({ budgetsByCostCenter: new Map([["INFRA-042", "10000.00"]]) });
    expect(budgetAvailable(buildPayable(), context)).toEqual({ ok: true });
  });
});

describe("proofExpiry (structural no-op in week 1)", () => {
  it("passes when the payable has no expiresAt yet", () => {
    expect(proofExpiry(buildPayable(), buildContext())).toEqual({ ok: true });
  });

  it("passes when expiresAt is in the future", () => {
    const payable = buildPayable({ expiresAt: new Date("2026-12-31") });
    expect(proofExpiry(payable, buildContext())).toEqual({ ok: true });
  });

  it("fails with PROOF_EXPIRED once a real expiresAt has passed", () => {
    const payable = buildPayable({ expiresAt: new Date("2026-01-01") });
    const result = proofExpiry(payable, buildContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("PROOF_EXPIRED");
  });
});
