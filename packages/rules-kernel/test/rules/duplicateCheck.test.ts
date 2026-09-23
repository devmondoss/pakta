import { describe, expect, it } from "vitest";
import { duplicateCheck } from "../../src/rules/duplicateCheck.js";
import { invoiceFingerprint } from "../../src/types.js";
import { buildContext, buildPayable } from "../helpers.js";

describe("duplicateCheck", () => {
  it("passes when the fingerprint is unknown", () => {
    expect(duplicateCheck(buildPayable(), buildContext())).toEqual({ ok: true });
  });

  it("fails with DUPLICATE_INVOICE when the fingerprint is already known", () => {
    const payable = buildPayable();
    const context = buildContext({ knownInvoiceFingerprints: new Set([invoiceFingerprint(payable)]) });
    const result = duplicateCheck(payable, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("DUPLICATE_INVOICE");
  });

  it("fails with PAYMENT_ALREADY_SETTLED (not DUPLICATE_INVOICE) when the fingerprint was already settled", () => {
    const payable = buildPayable();
    const context = buildContext({ settledInvoiceFingerprints: new Set([invoiceFingerprint(payable)]) });
    const result = duplicateCheck(payable, context);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("PAYMENT_ALREADY_SETTLED");
  });

  it("passes regardless of fingerprint when duplicate_detection is disabled", () => {
    const payable = buildPayable();
    const context = buildContext({
      knownInvoiceFingerprints: new Set([invoiceFingerprint(payable)]),
      policy: { ...buildContext().policy, rules: { ...buildContext().policy.rules, duplicate_detection: false } },
    });
    expect(duplicateCheck(payable, context)).toEqual({ ok: true });
  });
});
