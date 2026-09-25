import type { ProofOfPayable } from "@pakta/canonical-model";
import { decimalToUnits } from "@pakta/stellar-sdk-wrapper";
import { SettlementRefused, type SettlementAdapter, type SettlementContext, type SettlementOutcome } from "./adapter.js";
import type { GateClient } from "./chain.js";
import type { Deployment } from "./deployment.js";
import type { EventIndexer, IndexerReport } from "./indexer.js";
import type { Issuer } from "./issuer.js";
import type { SettlementStore } from "./store.js";

/** A payable the kernel has just evaluated as READY, with its proof built. */
export type ReadyPayable = { proof: ProofOfPayable; context: SettlementContext };

export type AgentReport = {
  indexed?: IndexerReport;
  swept: number;
  settled: { payableId: string; outcome: SettlementOutcome["status"]; txHash?: string }[];
  skipped: { payableId: string; reason: string }[];
  failed: { payableId: string; reason: string }[];
};

/**
 * The Settlement Agent: the loop that pays suppliers without a human approving
 * each payment — which is the point of the product.
 *
 * What makes it safe to leave running is not the agent; it is that the agent
 * cannot express a payment the gate would refuse. Its vocabulary is a READY
 * payable whose proof the issuer signed. It has no way to say "pay this amount
 * to that wallet", so a bug, a bad prompt or a compromised host can at worst
 * pay the wrong READY payable — never the wrong wallet.
 *
 * Each cycle:
 *   1. catch up on the chain's events (the source of truth for what settled);
 *   2. sweep lapsed registrations, releasing the float they were holding;
 *   3. settle what the kernel says is READY, soonest-expiring first, within
 *      what the vault can actually cover.
 */
export class SettlementAgent {
  readonly #adapter: SettlementAdapter;
  readonly #gate: GateClient;
  readonly #store: SettlementStore;
  readonly #issuer: Issuer;
  readonly #deployment: Deployment;
  readonly #indexer?: EventIndexer;
  readonly #listReady: () => Promise<ReadyPayable[]>;
  readonly #now: () => Date;
  #timer?: ReturnType<typeof setInterval>;
  #running = false;

  constructor(options: {
    adapter: SettlementAdapter;
    gate: GateClient;
    store: SettlementStore;
    issuer: Issuer;
    deployment: Deployment;
    indexer?: EventIndexer;
    /** Supplied by whoever owns the kernel — the agent never evaluates rules itself. */
    listReady: () => Promise<ReadyPayable[]>;
    now?: () => Date;
  }) {
    this.#adapter = options.adapter;
    this.#gate = options.gate;
    this.#store = options.store;
    this.#issuer = options.issuer;
    this.#deployment = options.deployment;
    this.#indexer = options.indexer;
    this.#listReady = options.listReady;
    this.#now = options.now ?? (() => new Date());
  }

  async runOnce(): Promise<AgentReport> {
    const report: AgentReport = { swept: 0, settled: [], skipped: [], failed: [] };

    if (this.#indexer) {
      try {
        report.indexed = await this.#indexer.poll();
      } catch (error) {
        // An unreachable RPC must not stop payments that can still be made;
        // the adapter reads on-chain state itself before acting.
        report.failed.push({ payableId: "(indexer)", reason: (error as Error).message });
      }
    }

    report.swept = await this.#sweep();

    const nowSeconds = Math.floor(this.#now().getTime() / 1000);
    const candidates = (await this.#listReady())
      .filter(({ proof }) => !this.#store.getSettlement(proof.payable_id))
      .sort((a, b) => Date.parse(a.proof.expires_at) - Date.parse(b.proof.expires_at));

    let available = await this.#gate.getAvailable();

    for (const { proof, context } of candidates) {
      const amount = decimalToUnits(proof.amount);
      const alreadyRegistered = this.#store.getProof(proof.payable_id)?.status === "REGISTERED";

      // A payable already registered is already committed, so it does not need
      // fresh headroom; a new one does, and the gate would refuse it anyway.
      if (!alreadyRegistered && amount > available) {
        report.skipped.push({
          payableId: proof.payable_id,
          reason: `vault has ${available} units available, ${proof.payable_id} needs ${amount}`,
        });
        continue;
      }
      if (Date.parse(proof.expires_at) / 1000 <= nowSeconds) {
        report.skipped.push({ payableId: proof.payable_id, reason: "proof already expired" });
        continue;
      }

      try {
        const { signed } = this.#issuer.sign(proof, this.#deployment);
        const outcome = await this.#adapter.settle(signed, context);
        report.settled.push({
          payableId: proof.payable_id,
          outcome: outcome.status,
          txHash: outcome.status === "SETTLED" ? outcome.settleTx.txHash : outcome.settlement?.settlement.tx_hash,
        });
        if (outcome.status === "SETTLED" && !alreadyRegistered) available -= amount;
      } catch (error) {
        report.failed.push({
          payableId: proof.payable_id,
          reason: error instanceof SettlementRefused ? `${error.reason}: ${error.message}` : (error as Error).message,
        });
      }
    }

    return report;
  }

  /**
   * Expires registrations whose proofs have lapsed. Without this the float
   * they committed stays locked: the contract cannot notice time passing on
   * its own. `expire_batch` skips anything not expirable, so a payable that
   * settled a moment ago does not fail the sweep.
   */
  async #sweep(): Promise<number> {
    const nowSeconds = Math.floor(this.#now().getTime() / 1000);
    const lapsed = this.#store.listOpenRegistrations().filter((p) => p.expiry < nowSeconds);
    if (lapsed.length === 0) return 0;

    await this.#gate.expireBatch(lapsed.map((p) => p.payableIdHash));
    let expired = 0;
    for (const proof of lapsed) {
      const onChain = await this.#gate.getPayable(proof.payableIdHash);
      if (onChain?.status === "EXPIRED") {
        this.#store.setProofStatus(proof.payableIdHash, "EXPIRED");
        expired += 1;
      } else if (onChain?.status === "SETTLED") {
        this.#store.setProofStatus(proof.payableIdHash, "SETTLED");
      }
    }
    return expired;
  }

  /** Runs a cycle every `intervalMs`. Cycles never overlap. */
  start(intervalMs: number, onReport?: (report: AgentReport) => void, onError?: (error: unknown) => void): void {
    if (this.#timer) return;
    const tick = async () => {
      if (this.#running) return;
      this.#running = true;
      try {
        onReport?.(await this.runOnce());
      } catch (error) {
        onError?.(error);
      } finally {
        this.#running = false;
      }
    };
    this.#timer = setInterval(tick, intervalMs);
    void tick();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
