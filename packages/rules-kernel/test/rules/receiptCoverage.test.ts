import { describe, expect, it } from "vitest";
import { receiptCoverage } from "../../src/rules/receiptCoverage.js";
import { buildContext, buildPayable } from "../helpers.js";

describe("receiptCoverage", () => {
  it("passes when receipt fully covers the invoiced quantity", () => {
    expect(receiptCoverage(buildPayable(), buildContext())).toEqual({ ok: true });
  });

  it("fails with MISSING_RECEIPT when there is no receipt row and policy requires one", () => {
    const payable = buildPayable({ receipts: [] });
    const result = receiptCoverage(payable, buildContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("MISSING_RECEIPT");
  });

  it("passes with no receipt row when policy does not require one", () => {
    const payable = buildPayable({ receipts: [] });
    const context = buildContext({
      policy: { ...buildContext().policy, rules: { ...buildContext().policy.rules, require_receipt: false } },
    });
    expect(receiptCoverage(payable, context)).toEqual({ ok: true });
  });

  it("fails with PARTIAL_RECEIPT when confirmed quantity falls short of invoiced quantity", () => {
    const payable = buildPayable({
      receipts: [
        { poId: "PO-TEST-001", confirmedQty: 0.5, invoicedQty: 1, confirmedBy: "ops@pakta.demo", confirmedAt: new Date("2026-09-20") },
      ],
    });
    const result = receiptCoverage(payable, buildContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("PARTIAL_RECEIPT");
  });

  it("passes when invoicedQty is untracked on every receipt row", () => {
    const payable = buildPayable({
      receipts: [
        { poId: "PO-TEST-001", confirmedQty: 1, confirmedBy: "ops@pakta.demo", confirmedAt: new Date("2026-09-20") },
      ],
    });
    expect(receiptCoverage(payable, buildContext())).toEqual({ ok: true });
  });
});
