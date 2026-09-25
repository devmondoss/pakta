import { getKnownFingerprints, getReceipt, getSettledFingerprints, getWallet, listPayables, type Db } from "@pakta/db";
import { evaluateBatch, type KernelResult } from "@pakta/rules-kernel";
import type { CanonicalPayable } from "@pakta/canonical-model";
import { loadPolicy } from "./ingest.js";

export type LiveEvaluation = { payables: CanonicalPayable[]; results: KernelResult[] };

/**
 * Reads whatever has actually been ingested (`@pakta/db`'s `payables`
 * table — filled by real uploads through `POST /ingest`, not a fixture
 * re-parsed on every call) and evaluates it against current DB state
 * (live wallets, live receipts, live fingerprints) and the current time.
 * Safe to call on every request — nothing here is cached stale.
 */
export async function evaluateLive(db: Db, now: Date = new Date()): Promise<LiveEvaluation> {
  const [payables, policy] = await Promise.all([listPayables(db), loadPolicy()]);

  const withLiveState = await Promise.all(
    payables.map(async (payable) => {
      const poId = payable.purchaseOrder?.poId;
      const liveReceipt = poId ? await getReceipt(db, poId) : undefined;
      return {
        ...payable,
        vendorWallet: await getWallet(db, payable.vendor.vendorId),
        receipts: liveReceipt ? [liveReceipt] : payable.receipts,
      };
    }),
  );

  const [knownInvoiceFingerprints, settledInvoiceFingerprints] = await Promise.all([
    getKnownFingerprints(db),
    getSettledFingerprints(db),
  ]);

  const results = evaluateBatch(withLiveState, {
    policy,
    now,
    knownInvoiceFingerprints,
    settledInvoiceFingerprints,
  });

  return { payables: withLiveState, results };
}
