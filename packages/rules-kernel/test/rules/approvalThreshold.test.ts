import { describe, expect, it } from "vitest";
import { approvalThreshold } from "../../src/rules/approvalThreshold.js";
import { buildContext, buildPayable } from "../helpers.js";

describe("approvalThreshold", () => {
  it("passes with one approval below the second-approval threshold", () => {
    expect(approvalThreshold(buildPayable(), buildContext())).toEqual({ ok: true });
  });

  it("fails with APPROVAL_MISSING when there are no approvals at all", () => {
    const payable = buildPayable({ approvals: [] });
    const result = approvalThreshold(payable, buildContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("APPROVAL_MISSING");
  });

  it("fails with APPROVAL_MISSING when above the second-approval threshold with only one approval", () => {
    const payable = buildPayable({
      invoice: { ...buildPayable().invoice, amount: "6000.00" }, // above second_approval_above (5000.00)
      purchaseOrder: { ...buildPayable().purchaseOrder!, amount: "6000.00" },
    });
    const result = approvalThreshold(payable, buildContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("APPROVAL_MISSING");
  });

  it("passes above the second-approval threshold with two approvals", () => {
    const payable = buildPayable({
      invoice: { ...buildPayable().invoice, amount: "6000.00" },
      purchaseOrder: { ...buildPayable().purchaseOrder!, amount: "6000.00" },
      approvals: [...buildPayable().approvals, { ...buildPayable().approvals[0]!, approverId: "cfo@pakta.demo" }],
    });
    expect(approvalThreshold(payable, buildContext())).toEqual({ ok: true });
  });
});
