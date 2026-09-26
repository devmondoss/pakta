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
 * kernel's duplicate/settlement rules read, settlements, and the
 * settlement path's own state (proofs, raw chain events, indexer cursors).
 */
export const TABLE_NAMES = [
  "payables",
  "vendor_wallets",
  "receipts",
  "known_invoice_fingerprints",
  "settled_invoice_fingerprints",
  "settlements",
  "proofs",
  "chain_events",
  "indexer_cursors",
] as const;

/**
 * One statement per call, not one multi-statement string — Neon's HTTP
 * driver sends each query as its own prepared statement and refuses
 * multiple commands in one call. Schema-qualified so tests (schema
 * `pakta_test`) can never collide with the running app's real data
 * (schema `public`) even though they share one Neon database.
 *
 * Every statement is idempotent (`IF NOT EXISTS`), because this runs on
 * every boot against a database that may already hold real data.
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
    // Settlement v1.1 (Pakta_Division_Trabajo.md §7): which proof authorized
    // the payment and which gate it went through. Added as a migration, not
    // in the CREATE above, so databases created before v1.1 gain the columns
    // without losing rows. Rows written before this have them NULL and are
    // treated as unverified by the readers.
    `ALTER TABLE ${schema}.settlements ADD COLUMN IF NOT EXISTS proof_hash TEXT`,
    `ALTER TABLE ${schema}.settlements ADD COLUMN IF NOT EXISTS contract_id TEXT`,
    // Settlement path (Dev 1). A proof is recorded when it is signed, so an
    // on-chain event — which only carries the payable id's hash — can be
    // traced back to the business payable, invoice and PO it settled.
    `CREATE TABLE IF NOT EXISTS ${schema}.proofs (
      payable_id_hash   TEXT PRIMARY KEY,
      payable_id        TEXT NOT NULL,
      proof_hash        TEXT NOT NULL,
      invoice_id        TEXT NOT NULL,
      po_id             TEXT NOT NULL,
      vendor_id         TEXT NOT NULL,
      amount            TEXT NOT NULL,
      asset             TEXT NOT NULL,
      expiry            BIGINT NOT NULL,
      status            TEXT NOT NULL CHECK (status IN ('SIGNED', 'REGISTERED', 'SETTLED', 'REVOKED', 'EXPIRED')),
      register_tx_hash  TEXT
    )`,
    // Raw on-chain events, keyed by the RPC's globally unique event id. The
    // RPC only retains events for a limited window, so this table — not the
    // RPC — is the durable audit log.
    `CREATE TABLE IF NOT EXISTS ${schema}.chain_events (
      id               TEXT PRIMARY KEY,
      type             TEXT NOT NULL,
      ledger           INTEGER NOT NULL,
      tx_hash          TEXT NOT NULL,
      payable_id_hash  TEXT,
      payload          TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS ${schema}.indexer_cursors (
      name    TEXT PRIMARY KEY,
      cursor  TEXT,
      ledger  INTEGER
    )`,
  ];
}
