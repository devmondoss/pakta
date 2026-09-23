import { describe, expect, it } from "vitest";
import { vendorAmountMatch } from "../../src/rules/vendorAmountMatch.js";
import { buildContext, buildPayable } from "../helpers.js";

describe("vendorAmountMatch", () => {
  it("passes when invoice amount equals the PO amount", () => {
    const payable = buildPayable();
    expect(vendorAmountMatch(payable, buildContext())).toEqual({ ok: true });
  });

  it("passes when invoice amount is within the tolerance band", () => {
    const payable = buildPayable({
      invoice: { ...buildPayable().invoice, amount: "1020.00" }, // 2% of 1000.00
    });
    expect(vendorAmountMatch(payable, buildContext())).toEqual({ ok: true });
  });

  it("fails with PO_AMOUNT_MISMATCH when invoice amount exceeds PO + tolerance", () => {
    const payable = buildPayable({
      invoice: { ...buildPayable().invoice, amount: "1100.00" },
    });
    const result = vendorAmountMatch(payable, buildContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("PO_AMOUNT_MISMATCH");
  });

  it("passes when there is no PO to compare against", () => {
    const payable = buildPayable({ purchaseOrder: undefined });
    expect(vendorAmountMatch(payable, buildContext())).toEqual({ ok: true });
  });
});
