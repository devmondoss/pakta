import type { Rule } from "../types.js";

/**
 * §7.3 rule 5: `vendor_wallet == active_attested_wallet`.
 *
 * `policy.rules.wallet_change_requires_human` is implicitly always honored
 * here: there is no auto-approve path in week 1, so any wallet mismatch
 * blocks unconditionally. If an auto-approve-below-some-amount path is
 * added later, gate it on this flag explicitly.
 */
export const walletAttestation: Rule = (payable) => {
  const wallet = payable.vendorWallet;

  if (!wallet || wallet.attestationStatus !== "ATTESTED" || payable.vendor.verificationStatus !== "VERIFIED") {
    return {
      ok: false,
      reason: "UNATTESTED_WALLET",
      message: `Vendor ${payable.vendor.legalName} has no attested wallet on file.`,
      evidence: { vendorId: payable.vendor.vendorId },
    };
  }

  if (wallet.address !== payable.invoice.walletAddress) {
    return {
      ok: false,
      reason: "VENDOR_WALLET_CHANGED",
      message: `Invoice requests payment to ${payable.invoice.walletAddress}, which differs from the attested wallet ${wallet.address}.`,
      evidence: {
        attestedWallet: wallet.address,
        requestedWallet: payable.invoice.walletAddress,
        attestationVersion: wallet.version,
      },
    };
  }

  return { ok: true };
};
