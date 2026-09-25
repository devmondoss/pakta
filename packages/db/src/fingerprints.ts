import type { Db } from "./db.js";

type FingerprintRow = { fingerprint: string };

/** External facts the kernel's `duplicateCheck`/`PAYMENT_ALREADY_SETTLED` rules read — previously a hardcoded `Set` literal in `apps/api`. */
export async function getKnownFingerprints(db: Db): Promise<Set<string>> {
  const rows = (await db.query(`SELECT fingerprint FROM ${db.schema}.known_invoice_fingerprints`)) as FingerprintRow[];
  return new Set(rows.map((r) => r.fingerprint));
}

export async function getSettledFingerprints(db: Db): Promise<Set<string>> {
  const rows = (await db.query(
    `SELECT fingerprint FROM ${db.schema}.settled_invoice_fingerprints`,
  )) as FingerprintRow[];
  return new Set(rows.map((r) => r.fingerprint));
}

export async function addKnownFingerprint(db: Db, fingerprint: string, note?: string): Promise<void> {
  await db.query(
    `INSERT INTO ${db.schema}.known_invoice_fingerprints (fingerprint, note) VALUES ($1, $2) ON CONFLICT (fingerprint) DO NOTHING`,
    [fingerprint, note ?? null],
  );
}

export async function addSettledFingerprint(db: Db, fingerprint: string, note?: string): Promise<void> {
  await db.query(
    `INSERT INTO ${db.schema}.settled_invoice_fingerprints (fingerprint, note) VALUES ($1, $2) ON CONFLICT (fingerprint) DO NOTHING`,
    [fingerprint, note ?? null],
  );
}
