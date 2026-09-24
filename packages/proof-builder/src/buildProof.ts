import type { CanonicalPayable, ProofOfPayable } from "@pakta/canonical-model";
import type { KernelResult } from "@pakta/rules-kernel";
import { canonicalHash } from "./canonicalHash.js";

/**
 * How long a freshly-built Proof-of-Payable is valid for before Dev 1's
 * `proofExpiry` check on the kernel side would reject it. Not specified
 * anywhere in the product docs — 48h is a hackathon-reasonable default
 * (long enough to survive a demo re-run, short enough to force
 * revalidation if a payable sits unsettled for days). Tune freely; no
 * other code depends on this exact number.
 */
const DEFAULT_VALIDITY_HOURS = 48;

/**
 * Only asset Pakta settles today per the product docs (§6.1, §18.4) —
 * hardcoded until a second asset/currency is ever in scope.
 */
const ASSET = "USDC";

/** `CanonicalPayable` has no cost-center field yet — same "not wired in week 1" state as `budgetAvailable`'s rule. */
const COST_CENTER_PLACEHOLDER = "UNSPECIFIED";

export class ProofBuilderError extends Error {}

/**
 * Arms the exact `ProofOfPayable` contract Dev 1's Settlement Adapter
 * consumes (`Pakta_Division_Trabajo.md` §5), for one payable the kernel
 * has just evaluated as `READY`.
 *
 * The kernel result is a required argument, not re-derived here — this
 * function refuses to build a proof for anything it isn't handed
 * explicit, already-computed READY evidence for. That's the one
 * deterministic gate between "a payable looks fine" and "money can move."
 */
export function buildProofOfPayable(payable: CanonicalPayable, result: KernelResult, now: Date): ProofOfPayable {
  if (result.status !== "READY") {
    throw new ProofBuilderError(`cannot build a proof for ${payable.payableId}: kernel result is BLOCKED`);
  }
  if (result.payableId !== payable.payableId) {
    throw new ProofBuilderError(
      `kernel result is for ${result.payableId}, not ${payable.payableId} — refusing to build a mismatched proof`,
    );
  }
  if (!payable.vendorWallet) {
    throw new ProofBuilderError(`${payable.payableId} is READY but has no attested vendor wallet on file`);
  }

  const expiresAt = new Date(now.getTime() + DEFAULT_VALIDITY_HOURS * 60 * 60 * 1000);

  return {
    payable_id: payable.payableId,
    invoice_hash: payable.invoice.sourceHash,
    po_hash: payable.purchaseOrder ? canonicalHash(payable.purchaseOrder) : canonicalHash(null),
    vendor_id: payable.vendor.vendorId,
    vendor_wallet: payable.vendorWallet.address,
    wallet_attestation_version: payable.vendorWallet.version,
    amount: payable.invoice.amount,
    asset: ASSET,
    policy_version: result.policyVersion,
    approvals_hash: canonicalHash(payable.approvals),
    cost_center: COST_CENTER_PLACEHOLDER,
    expires_at: expiresAt.toISOString(),
    status: "READY",
  };
}
