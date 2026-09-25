import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addKnownFingerprint,
  getKnownFingerprints,
  getSettledFingerprints,
  getWallet,
  seedWalletIfAbsent,
  type Db,
} from "@pakta/db";
import { ingestWorkbook } from "@pakta/ingestion";
import { evaluateBatch, loadPolicyFromYaml, type KernelResult } from "@pakta/rules-kernel";
import type { CanonicalPayable, Policy } from "@pakta/canonical-model";

const fixturesDir = path.resolve(import.meta.dirname, "../../../fixtures/demo-workbook");

/**
 * The canonical 5-invoice demo, as `ingestWorkbook` produced it — this
 * part is immutable, re-derivable from the workbook, and cached once per
 * process. Runtime-mutable facts (vendor wallets, known/settled
 * fingerprints) are NOT baked into this: they're overlaid live from
 * `@pakta/db` on every read in `evaluateLive`, so a wallet reverification
 * (HU-D2-15) or a new known fingerprint takes effect on the very next
 * request without needing this cache invalidated.
 */
let ingestedCache: Promise<{ payables: CanonicalPayable[]; policy: Policy }> | undefined;

function loadIngested() {
  ingestedCache ??= (async () => {
    const policy = loadPolicyFromYaml(readFileSync(path.join(fixturesDir, "policy.yaml"), "utf-8"));
    const workbookBuffer = readFileSync(path.join(fixturesDir, "demo-workbook.xlsx"));
    const { payables } = await ingestWorkbook(workbookBuffer, policy);
    return { payables, policy };
  })();
  return ingestedCache;
}

/**
 * Seeds `@pakta/db` from the fixture's ingestion output — but only fills
 * in gaps (`seedWalletIfAbsent`, `ON CONFLICT DO NOTHING` fingerprints).
 * Safe to call on every boot: once a wallet has been reverified through
 * the real API, this never overwrites it back to the fixture's original.
 */
export async function seedFromFixture(db: Db): Promise<void> {
  const { payables } = await loadIngested();
  for (const payable of payables) {
    if (payable.vendorWallet) seedWalletIfAbsent(db, payable.vendorWallet);
  }
  // The one external fact the canonical demo depends on (§25 maestro):
  // INV-1994 for Northline Supplies was already recorded 11 days before
  // the fixture's invoices — not part of this ingested batch.
  addKnownFingerprint(db, "VEN-002|3500.00", "INV-1994, recorded 11 days before the demo batch");
}

export type LiveEvaluation = { payables: CanonicalPayable[]; results: KernelResult[] };

/** Re-evaluates the fixture's payables against current DB state (live wallets + fingerprints) and the current time. Cheap and pure — safe to call on every request. */
export async function evaluateLive(db: Db, now: Date = new Date()): Promise<LiveEvaluation> {
  const { payables, policy } = await loadIngested();

  const withLiveWallets = payables.map((payable) => ({
    ...payable,
    vendorWallet: getWallet(db, payable.vendor.vendorId),
  }));

  const results = evaluateBatch(withLiveWallets, {
    policy,
    now,
    knownInvoiceFingerprints: getKnownFingerprints(db),
    settledInvoiceFingerprints: getSettledFingerprints(db),
  });

  return { payables: withLiveWallets, results };
}
