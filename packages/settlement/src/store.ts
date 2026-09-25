/**
 * What the settlement path needs to remember, as an interface.
 *
 * `@pakta/db` implements it on SQLite; tests implement it in memory. Keeping it
 * an interface is what lets the adapter, indexer and agent stay free of any
 * particular database — and keeps Dev 1's persistence from reaching into
 * Dev 2's tables beyond the one agreed fact (settled fingerprints).
 */
export type ErpPostingStatus = "PENDING" | "RECONCILED" | "FAILED";

export type ProofRecord = {
  payableId: string;
  payableIdHash: string;
  proofHash: string;
  invoiceId: string;
  poId: string;
  vendorId: string;
  amount: string;
  asset: string;
  expiry: number;
  /** Where this proof is on its way to the chain. */
  status: "SIGNED" | "REGISTERED" | "SETTLED" | "REVOKED" | "EXPIRED";
  registerTxHash?: string;
};

export type SettlementRecord = {
  payableId: string;
  invoiceId: string;
  poId: string;
  proofHash: string;
  contractId: string;
  asset: string;
  amount: string;
  txHash: string;
  ledger: number;
  erpPostingStatus: ErpPostingStatus;
  settledAt: string;
};

export type ChainEventRecord = {
  /** The RPC's event id — globally unique, so it is the dedup key. */
  id: string;
  type: string;
  ledger: number;
  txHash: string;
  payableIdHash?: string;
  payload: Record<string, unknown>;
};

export interface SettlementStore {
  upsertProof(proof: ProofRecord): void;
  getProofByIdHash(payableIdHash: string): ProofRecord | undefined;
  getProof(payableId: string): ProofRecord | undefined;
  setProofStatus(payableIdHash: string, status: ProofRecord["status"], registerTxHash?: string): void;
  /** Proofs registered on-chain and not yet settled, revoked or expired — the sweep's candidates. */
  listOpenRegistrations(): ProofRecord[];

  /** Idempotent: a second write for the same payable is ignored, never duplicated. */
  recordSettlement(settlement: SettlementRecord): void;
  getSettlement(payableId: string): SettlementRecord | undefined;
  listSettlements(): SettlementRecord[];

  /** Returns false if the event was already recorded. */
  recordChainEvent(event: ChainEventRecord): boolean;
  /** The most recent recorded event of a given type for a payable, if any. */
  findChainEvent(payableIdHash: string, type: string): ChainEventRecord | undefined;
  getCursor(name: string): { cursor?: string; ledger?: number } | undefined;
  setCursor(name: string, value: { cursor?: string; ledger?: number }): void;

  /**
   * The one fact the settlement path hands back to the kernel: this
   * `vendorId|amount` has been paid. The kernel's PAYMENT_ALREADY_SETTLED rule
   * reads it, so an invoice that settled cannot be settled again even under a
   * new payable id.
   */
  addSettledFingerprint(fingerprint: string, note: string): void;
}
