import { createSettlementStore, type Db, type PostgresSettlementStore } from "@pakta/db";
import { buildProofOfPayable } from "@pakta/proof-builder";
import {
  EventIndexer,
  Issuer,
  RpcEventSource,
  SettlementAdapter,
  SettlementAgent,
  SorobanGateClient,
  loadDeployment,
  type Deployment,
  type GateClient,
  type ReadyPayable,
} from "@pakta/settlement";
import type { CanonicalPayable } from "@pakta/canonical-model";
import type { KernelResult } from "@pakta/rules-kernel";
import { evaluateLive } from "./demoData.js";

/**
 * The on-chain half of the API. Everything that needs a key lives here, and is
 * only switched on when both keys are present:
 *
 *   PAKTA_ISSUER_SECRET    signs proofs (never submits transactions)
 *   PAKTA_EXECUTOR_SECRET  submits and pays for transactions (never signs proofs)
 *
 * Two keys, on purpose. The executor can move a READY payable to SETTLED but
 * cannot invent one; the issuer can authorize an obligation but cannot pay it.
 * Neither alone is enough to steer money.
 */
export type ChainServices = {
  issuer: Issuer;
  gate: GateClient;
  adapter: SettlementAdapter;
  agent: SettlementAgent;
  indexer?: EventIndexer;
};

export type SettlementServices = {
  deployment: Deployment;
  store: PostgresSettlementStore;
  /** Absent when the keys are not configured — the API still serves everything read-only. */
  chain?: ChainServices;
};

export type ChainFactory = (context: {
  deployment: Deployment;
  store: PostgresSettlementStore;
  listReady: () => Promise<ReadyPayable[]>;
}) => ChainServices | undefined;

/** The kernel's invoice fingerprint — what PAYMENT_ALREADY_SETTLED checks against. */
export function fingerprintOf(payable: CanonicalPayable): string {
  return `${payable.invoice.vendorId}|${payable.invoice.amount}`;
}

export function settlementContext(payable: CanonicalPayable) {
  return {
    invoiceId: payable.invoice.invoiceId,
    poId: payable.purchaseOrder?.poId ?? payable.invoice.poId ?? "",
    fingerprint: fingerprintOf(payable),
  };
}

/** READY payables, with their v1.1 proofs, re-evaluated against the current state. */
export function readyPayables(db: Db, now: () => Date = () => new Date()) {
  return async (): Promise<ReadyPayable[]> => {
    const at = now();
    const { payables, results } = await evaluateLive(db, at);
    const ready: ReadyPayable[] = [];
    for (const payable of payables) {
      const result = results.find((r) => r.payableId === payable.payableId) as KernelResult | undefined;
      if (result?.status !== "READY") continue;
      ready.push({ proof: buildProofOfPayable(payable, result, at), context: settlementContext(payable) });
    }
    return ready;
  };
}

/** Wires the real Soroban client from the environment, or returns undefined if a key is missing. */
export const chainFromEnv: ChainFactory = ({ deployment, store, listReady }) => {
  if (!process.env.PAKTA_ISSUER_SECRET || !process.env.PAKTA_EXECUTOR_SECRET) return undefined;

  const issuer = Issuer.fromEnv();
  const gate = SorobanGateClient.fromEnv(deployment);
  const adapter = new SettlementAdapter({ gate, store, deployment });
  const indexer = new EventIndexer({ source: new RpcEventSource(deployment), store, deployment });
  const agent = new SettlementAgent({ adapter, gate, store, issuer, deployment, indexer, listReady });
  return { issuer, gate, adapter, agent, indexer };
};

export function createSettlementServices(
  db: Db,
  options: { deployment?: Deployment; chain?: ChainFactory; now?: () => Date } = {},
): SettlementServices {
  const deployment = options.deployment ?? loadDeployment(process.env.PAKTA_NETWORK ?? "testnet");
  const store = createSettlementStore(db);
  const chain = (options.chain ?? chainFromEnv)({ deployment, store, listReady: readyPayables(db, options.now) });
  return { deployment, store, chain };
}

export function explorerTxUrl(deployment: Deployment, txHash: string): string {
  return `https://stellar.expert/explorer/${deployment.network === "mainnet" ? "public" : deployment.network}/tx/${txHash}`;
}
