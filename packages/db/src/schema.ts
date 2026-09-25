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
`;
