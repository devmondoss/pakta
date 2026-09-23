import { describe, expect, it } from "vitest";
import { walletAttestation } from "../../src/rules/walletAttestation.js";
import { buildContext, buildPayable } from "../helpers.js";

describe("walletAttestation", () => {
  it("passes when the invoice wallet matches the attested wallet", () => {
    expect(walletAttestation(buildPayable(), buildContext())).toEqual({ ok: true });
  });

  it("fails with VENDOR_WALLET_CHANGED when the invoice wallet differs from the attested one", () => {
    const payable = buildPayable({
      invoice: { ...buildPayable().invoice, walletAddress: "GDIFFERENTWALLET" },
    });
    const result = walletAttestation(payable, buildContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("VENDOR_WALLET_CHANGED");
  });

  it("fails with UNATTESTED_WALLET when there is no vendor wallet on file", () => {
    const payable = buildPayable({ vendorWallet: undefined });
    const result = walletAttestation(payable, buildContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("UNATTESTED_WALLET");
  });

  it("fails with UNATTESTED_WALLET when the vendor is not VERIFIED", () => {
    const payable = buildPayable({
      vendor: { ...buildPayable().vendor, verificationStatus: "UNVERIFIED" },
    });
    const result = walletAttestation(payable, buildContext());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("UNATTESTED_WALLET");
  });
});
