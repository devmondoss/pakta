import type { Db } from "./db.js";

type FingerprintRow = { fingerprint: string };

/** External facts the kernel's `duplicateCheck`/`PAYMENT_ALREADY_SETTLED` rules read — previously a hardcoded `Set` literal in `apps/api`. */
export function getKnownFingerprints(db: Db): Set<string> {
  const rows = db.prepare("SELECT fingerprint FROM known_invoice_fingerprints").all() as FingerprintRow[];
  return new Set(rows.map((r) => r.fingerprint));
}

export function getSettledFingerprints(db: Db): Set<string> {
  const rows = db.prepare("SELECT fingerprint FROM settled_invoice_fingerprints").all() as FingerprintRow[];
  return new Set(rows.map((r) => r.fingerprint));
}

export function addKnownFingerprint(db: Db, fingerprint: string, note?: string): void {
  db.prepare("INSERT INTO known_invoice_fingerprints (fingerprint, note) VALUES (?, ?) ON CONFLICT (fingerprint) DO NOTHING").run(
    fingerprint,
    note ?? null,
  );
}

export function addSettledFingerprint(db: Db, fingerprint: string, note?: string): void {
  db.prepare(
    "INSERT INTO settled_invoice_fingerprints (fingerprint, note) VALUES (?, ?) ON CONFLICT (fingerprint) DO NOTHING",
  ).run(fingerprint, note ?? null);
}
