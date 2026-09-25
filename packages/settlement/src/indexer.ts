import { rpc, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { Deployment } from "./deployment.js";
import type { SettlementStore } from "./store.js";

/**
 * A decoded PayableGate event. `type` is the event's snake_case name as the
 * contract emits it (`settlement_executed`, `payable_revoked`, ...).
 */
export type GateEvent = {
  id: string;
  type: string;
  ledger: number;
  txHash: string;
  payableIdHash?: string;
  data: Record<string, unknown>;
};

export type EventPage = { events: GateEvent[]; cursor?: string; latestLedger: number };

/** Where events come from. The RPC in production; a list in tests. */
export interface EventSource {
  fetch(from: { cursor?: string; startLedger?: number }): Promise<EventPage>;
}

/** JSON-safe projection of a decoded ScVal: bytes become hex, bigints strings. */
function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}

export function decodeGateEvent(raw: {
  id: string;
  ledger: number;
  txHash: string;
  topic: xdr.ScVal[];
  value: xdr.ScVal;
}): GateEvent {
  const [name, second] = raw.topic;
  const type = name ? String(scValToNative(name)) : "unknown";
  const idValue = second ? scValToNative(second) : undefined;
  const payableIdHash =
    idValue instanceof Uint8Array && idValue.length === 32 ? Buffer.from(idValue).toString("hex") : undefined;
  const decoded = scValToNative(raw.value);
  const data =
    decoded && typeof decoded === "object" && !Array.isArray(decoded)
      ? (jsonSafe(decoded) as Record<string, unknown>)
      : { value: jsonSafe(decoded) };
  return { id: raw.id, type, ledger: raw.ledger, txHash: raw.txHash, payableIdHash, data };
}

/**
 * Reads the gate's events from Soroban RPC.
 *
 * The RPC only keeps events for a limited window. If the indexer falls further
 * behind than that, the RPC rejects the start ledger; this source then resumes
 * from the oldest ledger it still has and reports the gap, rather than
 * wedging forever on a cursor that can never be served again.
 */
export class RpcEventSource implements EventSource {
  readonly #server: rpc.Server;
  readonly #contractId: string;
  readonly #lookbackLedgers: number;
  lastGap?: { requested: number; resumedAt: number };

  constructor(deployment: Deployment, options: { lookbackLedgers?: number } = {}) {
    this.#server = new rpc.Server(deployment.rpcUrl);
    this.#contractId = deployment.contractId;
    this.#lookbackLedgers = options.lookbackLedgers ?? 17_280; // ~1 day
  }

  async fetch(from: { cursor?: string; startLedger?: number }): Promise<EventPage> {
    const filters = [{ type: "contract" as const, contractIds: [this.#contractId] }];
    let response: rpc.Api.GetEventsResponse;

    if (from.cursor) {
      response = await this.#server.getEvents({ cursor: from.cursor, filters, limit: 100 });
    } else {
      const latest = (await this.#server.getLatestLedger()).sequence;
      let startLedger = from.startLedger ?? Math.max(1, latest - this.#lookbackLedgers);
      try {
        response = await this.#server.getEvents({ startLedger, filters, limit: 100 });
      } catch (error) {
        const oldest = /oldest ledger:?\s*(\d+)/i.exec(String((error as Error).message))?.[1];
        if (!oldest) throw error;
        this.lastGap = { requested: startLedger, resumedAt: Number(oldest) };
        startLedger = Number(oldest);
        response = await this.#server.getEvents({ startLedger, filters, limit: 100 });
      }
    }

    return {
      events: response.events.map((e) =>
        decodeGateEvent({ id: e.id, ledger: e.ledger, txHash: e.txHash, topic: e.topic, value: e.value }),
      ),
      cursor: response.cursor,
      latestLedger: response.latestLedger,
    };
  }
}

export type IndexerReport = {
  fetched: number;
  recorded: number;
  settlementsRecorded: string[];
  /** Settlement events for payables this backend never signed a proof for. */
  unknownSettlements: string[];
};

const PROOF_STATUS_BY_EVENT: Record<string, "REGISTERED" | "REVOKED" | "EXPIRED"> = {
  payable_registered: "REGISTERED",
  payable_revoked: "REVOKED",
  payable_expired: "EXPIRED",
};

/**
 * Projects the gate's events into the settlement store.
 *
 * This is the independent reconciliation path of §14.2. The adapter records a
 * settlement when its own call returns — but a call can land and lose its
 * response. The indexer reads what actually happened on-chain and records it
 * regardless, so a settlement can never go unrecorded just because the process
 * that caused it crashed.
 *
 * Every event is stored raw first (deduplicated on the RPC's event id), which
 * makes re-processing a page harmless.
 */
export class EventIndexer {
  readonly #source: EventSource;
  readonly #store: SettlementStore;
  readonly #deployment: Deployment;
  readonly #name: string;

  constructor(options: { source: EventSource; store: SettlementStore; deployment: Deployment; name?: string }) {
    this.#source = options.source;
    this.#store = options.store;
    this.#deployment = options.deployment;
    this.#name = options.name ?? `gate:${options.deployment.contractId}`;
  }

  /**
   * Reads pages until the RPC stops making progress.
   *
   * Soroban RPC scans a bounded range of ledgers per request, so a page can
   * come back empty with its cursor moved forward — not because there is
   * nothing to read, but because the scan window ended first. Observed on
   * testnet: an empty first page, fourteen events on the second. An indexer
   * that stopped at the first empty page would sit blind until its next cycle,
   * or indefinitely with a wide enough window. "Caught up" means the cursor
   * stopped moving.
   */
  async poll(maxPages = 25): Promise<IndexerReport> {
    const report: IndexerReport = { fetched: 0, recorded: 0, settlementsRecorded: [], unknownSettlements: [] };
    let cursor = this.#store.getCursor(this.#name)?.cursor;

    for (let page = 0; page < maxPages; page += 1) {
      const result = await this.#source.fetch({ cursor });
      report.fetched += result.events.length;

      for (const event of result.events) {
        const isNew = this.#store.recordChainEvent({
          id: event.id,
          type: event.type,
          ledger: event.ledger,
          txHash: event.txHash,
          payableIdHash: event.payableIdHash,
          payload: event.data,
        });
        if (!isNew) continue;
        report.recorded += 1;
        this.#project(event, report);
      }

      const next = result.cursor ?? cursor;
      // Persist after every page, so a crash mid-scan resumes where it was.
      this.#store.setCursor(this.#name, { cursor: next, ledger: result.latestLedger });
      if (next === cursor && result.events.length === 0) break;
      cursor = next;
    }

    return report;
  }

  #project(event: GateEvent, report: IndexerReport): void {
    if (!event.payableIdHash) return;

    const status = PROOF_STATUS_BY_EVENT[event.type];
    if (status) {
      const proof = this.#store.getProofByIdHash(event.payableIdHash);
      // Never walk a proof backwards: a late REGISTERED must not undo SETTLED.
      if (proof && (status !== "REGISTERED" || proof.status === "SIGNED")) {
        this.#store.setProofStatus(event.payableIdHash, status, status === "REGISTERED" ? event.txHash : undefined);
      }
      return;
    }

    if (event.type !== "settlement_executed") return;

    const proof = this.#store.getProofByIdHash(event.payableIdHash);
    if (!proof) {
      report.unknownSettlements.push(event.payableIdHash);
      return;
    }
    if (!this.#store.getSettlement(proof.payableId)) {
      this.#store.recordSettlement({
        payableId: proof.payableId,
        invoiceId: proof.invoiceId,
        poId: proof.poId,
        proofHash: proof.proofHash,
        contractId: this.#deployment.contractId,
        asset: proof.asset,
        amount: proof.amount,
        txHash: event.txHash,
        ledger: event.ledger,
        erpPostingStatus: "PENDING",
        settledAt: new Date().toISOString(),
      });
      report.settlementsRecorded.push(proof.payableId);
    }
    this.#store.setProofStatus(event.payableIdHash, "SETTLED");
    this.#store.addSettledFingerprint(`${proof.vendorId}|${proof.amount}`, `${proof.payableId} settled in ${event.txHash}`);
  }
}
