import { z } from "zod";

/**
 * The ONE shared surface between Dev 2 (this package's owner) and Dev 1
 * (Web3/Settlement). Copied verbatim from `Pakta_Division_Trabajo.md` §5 —
 * "se edita en pareja, no unilateralmente". Do not change field names or
 * types here without syncing with Dev 1's branch first.
 */

/** Produced by Dev 2's Proof-of-Payable Builder, consumed by Dev 1's Settlement Adapter. */
export const ProofOfPayable = z.object({
  payable_id: z.string(),
  invoice_hash: z.string(),
  po_hash: z.string(),
  vendor_id: z.string(),
  vendor_wallet: z.string(),
  wallet_attestation_version: z.number().int(),
  amount: z.string(),
  asset: z.string(),
  policy_version: z.string(),
  approvals_hash: z.string(),
  cost_center: z.string(),
  /** ISO timestamp — Dev 1 revalidates this before settle(). */
  expires_at: z.string(),
  status: z.literal("READY"),
});
export type ProofOfPayable = z.infer<typeof ProofOfPayable>;

/** Produced by Dev 1's Settlement Adapter, consumed back by Dev 2 (and the dashboard). */
export const Settlement = z.object({
  payable_id: z.string(),
  invoice_id: z.string(),
  po_id: z.string(),
  settlement: z.object({
    network: z.literal("stellar"),
    asset: z.string(),
    amount: z.string(),
    tx_hash: z.string(),
    ledger: z.number().int(),
  }),
  status: z.literal("SETTLED"),
  erp_posting_status: z.enum(["PENDING", "RECONCILED", "FAILED"]),
});
export type Settlement = z.infer<typeof Settlement>;
