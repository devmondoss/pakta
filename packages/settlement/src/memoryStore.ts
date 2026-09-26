import type { ChainEventRecord, ProofRecord, SettlementRecord, SettlementStore } from "./store.js";

/** An in-memory SettlementStore for tests and throwaway processes. */
export class MemorySettlementStore implements SettlementStore {
  readonly proofs = new Map<string, ProofRecord>();
  readonly settlements = new Map<string, SettlementRecord>();
  readonly events = new Map<string, ChainEventRecord>();
  readonly cursors = new Map<string, { cursor?: string; ledger?: number }>();
  readonly settledFingerprints = new Map<string, string>();

  async upsertProof(proof: ProofRecord): Promise<void> {
    this.proofs.set(proof.payableIdHash, { ...proof });
  }

  async getProofByIdHash(payableIdHash: string): Promise<ProofRecord | undefined> {
    return this.proofs.get(payableIdHash);
  }

  async getProof(payableId: string): Promise<ProofRecord | undefined> {
    return [...this.proofs.values()].find((p) => p.payableId === payableId);
  }

  async setProofStatus(payableIdHash: string, status: ProofRecord["status"], registerTxHash?: string): Promise<void> {
    const proof = this.proofs.get(payableIdHash);
    if (!proof) return;
    proof.status = status;
    if (registerTxHash) proof.registerTxHash = registerTxHash;
  }

  async listOpenRegistrations(): Promise<ProofRecord[]> {
    return [...this.proofs.values()].filter((p) => p.status === "REGISTERED");
  }

  async recordSettlement(settlement: SettlementRecord): Promise<void> {
    if (!this.settlements.has(settlement.payableId)) this.settlements.set(settlement.payableId, { ...settlement });
  }

  async getSettlement(payableId: string): Promise<SettlementRecord | undefined> {
    return this.settlements.get(payableId);
  }

  async listSettlements(): Promise<SettlementRecord[]> {
    return [...this.settlements.values()];
  }

  async recordChainEvent(event: ChainEventRecord): Promise<boolean> {
    if (this.events.has(event.id)) return false;
    this.events.set(event.id, event);
    return true;
  }

  async findChainEvent(payableIdHash: string, type: string): Promise<ChainEventRecord | undefined> {
    return [...this.events.values()]
      .filter((e) => e.payableIdHash === payableIdHash && e.type === type)
      .sort((a, b) => b.ledger - a.ledger)[0];
  }

  async getCursor(name: string) {
    return this.cursors.get(name);
  }

  async setCursor(name: string, value: { cursor?: string; ledger?: number }): Promise<void> {
    this.cursors.set(name, value);
  }

  async addSettledFingerprint(fingerprint: string, note: string): Promise<void> {
    if (!this.settledFingerprints.has(fingerprint)) this.settledFingerprints.set(fingerprint, note);
  }
}
