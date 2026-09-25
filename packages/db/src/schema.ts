/**
 * Deliberately narrow scope: only the state that's genuinely *mutable* at
 * runtime lives here. Invoices/POs/receipts/approvals still come from
 * `ingestWorkbook` each boot — they're a re-derivable projection of the
 * source workbook, not runtime state, so duplicating them into their own
 * tables would be schema for schema's sake. `Pakta_Plan_Implementacion.md`
 * §5 describes the full target schema (Postgres, every entity); this is
 * the subset that actually needs to survive a restart and change under
 * writes for the hackathon slice: vendor wallets (HU-D2-15's reverification
 * flow) and the two external-fact sets the kernel's duplicate/settlement
 * rules read (`knownInvoiceFingerprints` / `settledInvoiceFingerprints`),
 * which previously lived as a hardcoded `Set` literal in `apps/api`.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS vendor_wallets (
  vendor_id           TEXT PRIMARY KEY,
  address             TEXT NOT NULL,
  attestation_status  TEXT NOT NULL CHECK (attestation_status IN ('ATTESTED', 'UNATTESTED')),
  version             INTEGER NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS known_invoice_fingerprints (
  fingerprint TEXT PRIMARY KEY,
  note        TEXT
);

CREATE TABLE IF NOT EXISTS settled_invoice_fingerprints (
  fingerprint TEXT PRIMARY KEY,
  note        TEXT
);

-- Settlement path (Dev 1). A proof is recorded when it is signed, so that an
-- on-chain event, which only carries the payable id's hash, can be traced back
-- to the business payable, invoice and PO it settled.
CREATE TABLE IF NOT EXISTS proofs (
  payable_id_hash   TEXT PRIMARY KEY,
  payable_id        TEXT NOT NULL,
  proof_hash        TEXT NOT NULL,
  invoice_id        TEXT NOT NULL,
  po_id             TEXT NOT NULL,
  vendor_id         TEXT NOT NULL,
  amount            TEXT NOT NULL,
  asset             TEXT NOT NULL,
  expiry            INTEGER NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('SIGNED', 'REGISTERED', 'SETTLED', 'REVOKED', 'EXPIRED')),
  register_tx_hash  TEXT
);

-- One row per payable that actually moved money. tx_hash is UNIQUE: two
-- settlements can never claim the same on-chain transaction.
CREATE TABLE IF NOT EXISTS settlements (
  payable_id          TEXT PRIMARY KEY,
  invoice_id          TEXT NOT NULL,
  po_id               TEXT NOT NULL,
  proof_hash          TEXT NOT NULL,
  contract_id         TEXT NOT NULL,
  asset               TEXT NOT NULL,
  amount              TEXT NOT NULL,
  tx_hash             TEXT NOT NULL UNIQUE,
  ledger              INTEGER NOT NULL,
  erp_posting_status  TEXT NOT NULL CHECK (erp_posting_status IN ('PENDING', 'RECONCILED', 'FAILED')),
  settled_at          TEXT NOT NULL
);

-- Raw on-chain events, keyed by the RPC's globally unique event id. The RPC
-- only retains events for a limited window, so this table — not the RPC — is
-- the durable audit log.
CREATE TABLE IF NOT EXISTS chain_events (
  id               TEXT PRIMARY KEY,
  type             TEXT NOT NULL,
  ledger           INTEGER NOT NULL,
  tx_hash          TEXT NOT NULL,
  payable_id_hash  TEXT,
  payload          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS indexer_cursors (
  name    TEXT PRIMARY KEY,
  cursor  TEXT,
  ledger  INTEGER
);
`;
