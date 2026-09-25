import type { ChainEventRecord, ProofRecord, SettlementRecord, SettlementStore } from "./store.js";

/** An in-memory SettlementStore for tests and throwaway processes. */
export class MemorySettlementStore implements SettlementStore {
  readonly proofs = new Map<string, ProofRecord>();
  readonly settlements = new Map<string, SettlementRecord>();
  readonly events = new Map<string, ChainEventRecord>();
  readonly cursors = new Map<string, { cursor?: string; ledger?: number }>();
  readonly settledFingerprints = new Map<string, string>();

  upsertProof(proof: ProofRecord): void {
    this.proofs.set(proof.payableIdHash, { ...proof });
  }

  getProofByIdHash(payableIdHash: string): ProofRecord | undefined {
    return this.proofs.get(payableIdHash);
  }

  getProof(payableId: string): ProofRecord | undefined {
    return [...this.proofs.values()].find((p) => p.payableId === payableId);
  }

  setProofStatus(payableIdHash: string, status: ProofRecord["status"], registerTxHash?: string): void {
    const proof = this.proofs.get(payableIdHash);
    if (!proof) return;
    proof.status = status;
    if (registerTxHash) proof.registerTxHash = registerTxHash;
  }

  listOpenRegistrations(): ProofRecord[] {
    return [...this.proofs.values()].filter((p) => p.status === "REGISTERED");
  }

  recordSettlement(settlement: SettlementRecord): void {
    if (!this.settlements.has(settlement.payableId)) this.settlements.set(settlement.payableId, { ...settlement });
  }

  getSettlement(payableId: string): SettlementRecord | undefined {
    return this.settlements.get(payableId);
  }

  listSettlements(): SettlementRecord[] {
    return [...this.settlements.values()];
  }

  recordChainEvent(event: ChainEventRecord): boolean {
    if (this.events.has(event.id)) return false;
    this.events.set(event.id, event);
    return true;
  }

  findChainEvent(payableIdHash: string, type: string): ChainEventRecord | undefined {
    return [...this.events.values()]
      .filter((e) => e.payableIdHash === payableIdHash && e.type === type)
      .sort((a, b) => b.ledger - a.ledger)[0];
  }

  getCursor(name: string) {
    return this.cursors.get(name);
  }

  setCursor(name: string, value: { cursor?: string; ledger?: number }): void {
    this.cursors.set(name, value);
  }

  addSettledFingerprint(fingerprint: string, note: string): void {
    if (!this.settledFingerprints.has(fingerprint)) this.settledFingerprints.set(fingerprint, note);
  }
}
