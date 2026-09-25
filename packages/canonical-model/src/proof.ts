import { z } from "zod";

/**
 * The ONE shared surface between Dev 2 (who produces a Proof-of-Payable) and
 * Dev 1 (who registers and settles it on Stellar). See
 * `Pakta_Division_Trabajo.md` §7.
 *
 * v1.1 tightens every field the settlement gate has to turn into bytes. Under
 * v1.0 these were free strings, which meant a proof could pass this schema and
 * still be impossible to settle: `expires_at` with milliseconds, evidence
 * hashes with a `sha256:` prefix, and 24-character placeholder wallets all
 * validated here and all failed at the adapter. Validation now happens where
 * the object is built, not three services later.
 */
export const PROOF_SCHEMA_VERSION = "1.1";

/** 64 lowercase hex characters, no `0x` and no `sha256:` prefix. */
const hex64 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters with no prefix");

/**
 * ISO-8601 UTC with second precision. The contract stores expiry as a u64 of
 * Unix seconds, so a fractional second has nowhere to go and an offset like
 * `+00:00` would give two strings for one instant — two different proof hashes
 * for one obligation.
 */
const utcSeconds = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'must be UTC with second precision, e.g. "2026-09-25T18:00:00Z"');

/**
 * Shape only: a `G...` StrKey is 56 base32 characters. The checksum is verified
 * by `@pakta/stellar-sdk-wrapper` in the settlement path; this catches the
 * placeholder class of mistake at the point the proof is built.
 */
const stellarAccount = z.string().regex(/^G[A-Z2-7]{55}$/, "must be a Stellar account id (G..., 56 characters)");
const stellarContract = z.string().regex(/^C[A-Z2-7]{55}$/, "must be a Stellar contract id (C..., 56 characters)");

/**
 * Positive decimal, up to the 7 decimals a Stellar asset carries, with no
 * leading zeros — `"05000.00"` and `"5000.00"` are the same money but would
 * hash differently.
 */
const proofAmount = z
  .string()
  .regex(/^(0|[1-9]\d*)(\.\d{1,7})?$/, "must be a plain decimal with at most 7 decimals and no leading zeros")
  .refine((value) => Number(value) > 0, "must be greater than zero");

/**
 * The payload that gets canonicalized (JCS) and hashed into `proof_hash`.
 *
 * `.strict()` is load-bearing: an unexpected field would change the hash
 * without anyone noticing, so unknown keys are rejected rather than carried.
 */
export const ProofOfPayable = z
  .object({
    payable_id: z.string().min(1),
    invoice_hash: hex64,
    po_hash: hex64,
    /** New in v1.1 — the proof now commits to the whole three-way match, not two thirds of it. */
    receipt_hash: hex64,
    vendor_id: z.string().min(1),
    vendor_wallet: stellarAccount,
    wallet_attestation_version: z.number().int().positive(),
    amount: proofAmount,
    asset: z.string().min(1),
    policy_version: z.string().min(1),
    approvals_hash: hex64,
    cost_center: z.string().min(1),
    /** Revalidated by Dev 1 before settle(). */
    expires_at: utcSeconds,
    status: z.literal("READY"),
  })
  .strict();
export type ProofOfPayable = z.infer<typeof ProofOfPayable>;

/**
 * A proof plus the issuer's authorization to register it on a specific
 * deployment.
 *
 * `issuer_signature` is Ed25519 over the *registration digest*, not over
 * `proof_hash` alone: the digest also binds network, contract, recipient,
 * asset, amount, policy and expiry, which is what stops a signed proof from
 * being replayed against another deployment or with a substituted recipient.
 */
export const SignedProofOfPayable = ProofOfPayable.extend({
  proof_hash: hex64,
  issuer_public_key: stellarAccount,
  /** Base64 of the 64-byte Ed25519 signature. */
  issuer_signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/, "must be base64 of a 64-byte Ed25519 signature"),
  network_passphrase: z.string().min(1),
  contract_id: stellarContract,
}).strict();
export type SignedProofOfPayable = z.infer<typeof SignedProofOfPayable>;

/** Produced by Dev 1's settlement path, consumed back by Dev 2 (and the dashboard). */
export const Settlement = z
  .object({
    payable_id: z.string().min(1),
    invoice_id: z.string().min(1),
    po_id: z.string().min(1),
    /** New in v1.1 — lets reconciliation walk tx -> settlement -> proof without a second lookup. */
    proof_hash: hex64,
    /** New in v1.1 — which gate the money actually left through. */
    contract_id: stellarContract,
    settlement: z.object({
      network: z.literal("stellar"),
      asset: z.string().min(1),
      amount: proofAmount,
      tx_hash: hex64,
      ledger: z.number().int().positive(),
    }),
    status: z.literal("SETTLED"),
    erp_posting_status: z.enum(["PENDING", "RECONCILED", "FAILED"]),
  })
  .strict();
export type Settlement = z.infer<typeof Settlement>;
