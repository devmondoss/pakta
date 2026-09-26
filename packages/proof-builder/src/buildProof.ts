import { ProofOfPayable, type CanonicalPayable } from "@pakta/canonical-model";
import type { KernelResult } from "@pakta/rules-kernel";
import { canonicalHash, sourceDigest } from "./canonicalHash.js";

/**
 * How long a freshly-built Proof-of-Payable is valid for before Dev 1's
 * `proofExpiry` check on the kernel side would reject it. Not specified
 * anywhere in the product docs — 48h is a hackathon-reasonable default
 * (long enough to survive a demo re-run, short enough to force
 * revalidation if a payable sits unsettled for days). The settlement gate
 * refuses proofs valid for longer than 7 days, so stay under that.
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
 * ISO-8601 UTC with second precision. `Date#toISOString` always emits
 * milliseconds (`...:00.000Z`), which the settlement gate cannot represent in
 * its u64 of Unix seconds — every proof built with it was rejected by the
 * adapter. Truncating to the second before formatting keeps the string and the
 * on-chain expiry describing the same instant.
 */
function toUtcSeconds(date: Date): string {
  const truncated = new Date(Math.floor(date.getTime() / 1000) * 1000);
  return truncated.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Arms the exact v1.1 `ProofOfPayable` Dev 1's settlement path consumes
 * (`Pakta_Division_Trabajo.md` §7), for one payable the kernel has just
 * evaluated as `READY`.
 *
 * The kernel result is a required argument, not re-derived here — this
 * function refuses to build a proof for anything it isn't handed
 * explicit, already-computed READY evidence for. That's the one
 * deterministic gate between "a payable looks fine" and "money can move."
 *
 * The result is validated against the v1.1 schema before it is returned, so a
 * proof that could not settle is refused here rather than three services later.
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

  const proof = {
    payable_id: payable.payableId,
    // A real source digest passes straight through. A placeholder label is
    // not a hash, so the proof commits to the canonical invoice instead —
    // which still includes that label, so nothing is lost.
    invoice_hash: sourceDigest(payable.invoice.sourceHash) ?? canonicalHash(payable.invoice),
    po_hash: canonicalHash(payable.purchaseOrder ?? null),
    receipt_hash: canonicalHash(payable.receipts),
    vendor_id: payable.vendor.vendorId,
    vendor_wallet: payable.vendorWallet.address,
    wallet_attestation_version: payable.vendorWallet.version,
    amount: payable.invoice.amount,
    asset: ASSET,
    policy_version: result.policyVersion,
    approvals_hash: canonicalHash(payable.approvals),
    cost_center: COST_CENTER_PLACEHOLDER,
    expires_at: toUtcSeconds(expiresAt),
    status: "READY" as const,
  };

  const parsed = ProofOfPayable.safeParse(proof);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new ProofBuilderError(`${payable.payableId} would produce a proof the settlement gate rejects — ${problems}`);
  }
  return parsed.data;
}
