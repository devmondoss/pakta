/**
 * Everything the running app reads and writes lives here now — there is
 * no fixture re-parsed on every request. `payables` is filled by the real
 * `POST /ingest` pipeline (`ingestWorkbook` -> this table); the one-time
 * exception is process boot, which ingests the demo workbook through that
 * *same* endpoint's code path if the table is empty, purely so the demo
 * isn't blank on a fresh database — after that it's ordinary persisted
 * data like anything else. `Pakta_Plan_Implementacion.md` §5 describes
 * the full target schema (every entity, its own table); this is the
 * subset actually needed for the hackathon slice: the ingested payables
 * themselves, vendor wallets (HU-D2-15's reverification flow), receipts
 * (Operations confirming delivery), the two external-fact sets the
 * kernel's duplicate/settlement rules read, and settlements (Dev 1's side
 * of the handoff, reported back to us).
 */
export const TABLE_NAMES = [
  "payables",
  "vendor_wallets",
  "receipts",
  "known_invoice_fingerprints",
  "settled_invoice_fingerprints",
  "settlements",
] as const;

/**
 * `activity_log` is deliberately NOT in `TABLE_NAMES`: that list is what
 * `resetDb` truncates, and the whole point of an activity history is
 * that it survives the actions it's logging — including a demo reset
 * itself, which should show up as one more entry, not erase the log.
 */
export const ACTIVITY_LOG_TABLE = "activity_log";

/**
 * One statement per call, not one multi-statement string — Neon's HTTP
 * driver sends each query as its own prepared statement and refuses
 * multiple commands in one call. Schema-qualified so tests (schema
 * `pakta_test`) can never collide with the running app's real data
 * (schema `public`) even though they share one Neon database.
 */
export function schemaStatements(schema: string): string[] {
  return [
    `CREATE TABLE IF NOT EXISTS ${schema}.payables (
      payable_id   TEXT PRIMARY KEY,
      data         TEXT NOT NULL,
      ingested_at  TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.vendor_wallets (
      vendor_id           TEXT PRIMARY KEY,
      address             TEXT NOT NULL,
      attestation_status  TEXT NOT NULL CHECK (attestation_status IN ('ATTESTED', 'UNATTESTED')),
      version             INTEGER NOT NULL,
      created_at          TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.receipts (
      po_id          TEXT PRIMARY KEY,
      confirmed_qty  NUMERIC NOT NULL,
      invoiced_qty   NUMERIC,
      confirmed_by   TEXT NOT NULL,
      confirmed_at   TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.known_invoice_fingerprints (
      fingerprint TEXT PRIMARY KEY,
      note        TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.settled_invoice_fingerprints (
      fingerprint TEXT PRIMARY KEY,
      note        TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.settlements (
      payable_id          TEXT PRIMARY KEY,
      invoice_id          TEXT NOT NULL,
      po_id               TEXT NOT NULL,
      network             TEXT NOT NULL,
      asset               TEXT NOT NULL,
      amount              TEXT NOT NULL,
      tx_hash             TEXT NOT NULL,
      ledger              INTEGER NOT NULL,
      erp_posting_status  TEXT NOT NULL CHECK (erp_posting_status IN ('PENDING', 'RECONCILED', 'FAILED')),
      settled_at          TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.${ACTIVITY_LOG_TABLE} (
      id           SERIAL PRIMARY KEY,
      occurred_at  TEXT NOT NULL,
      message      TEXT NOT NULL
    )`,
  ];
}
