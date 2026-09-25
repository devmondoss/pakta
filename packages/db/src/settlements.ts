import type { Db } from "./db.js";
import { addSettledFingerprint } from "./fingerprints.js";

/**
 * SQLite persistence for the settlement path (Dev 1).
 *
 * Declared with local types rather than importing `@pakta/settlement`, so the
 * database package does not depend on the settlement package. The shapes match
 * `SettlementStore` structurally, and TypeScript checks that at the one place
 * they are wired together (apps/api).
 */
export type ProofStatus = "SIGNED" | "REGISTERED" | "SETTLED" | "REVOKED" | "EXPIRED";

export type ProofRow = {
  payableId: string;
  payableIdHash: string;
  proofHash: string;
  invoiceId: string;
  poId: string;
  vendorId: string;
  amount: string;
  asset: string;
  expiry: number;
  status: ProofStatus;
  registerTxHash?: string;
};

export type SettlementRow = {
  payableId: string;
  invoiceId: string;
  poId: string;
  proofHash: string;
  contractId: string;
  asset: string;
  amount: string;
  txHash: string;
  ledger: number;
  erpPostingStatus: "PENDING" | "RECONCILED" | "FAILED";
  settledAt: string;
};

export type ChainEventRow = {
  id: string;
  type: string;
  ledger: number;
  txHash: string;
  payableIdHash?: string;
  payload: Record<string, unknown>;
};

type RawProof = {
  payable_id: string;
  payable_id_hash: string;
  proof_hash: string;
  invoice_id: string;
  po_id: string;
  vendor_id: string;
  amount: string;
  asset: string;
  expiry: number;
  status: ProofStatus;
  register_tx_hash: string | null;
};

type RawSettlement = {
  payable_id: string;
  invoice_id: string;
  po_id: string;
  proof_hash: string;
  contract_id: string;
  asset: string;
  amount: string;
  tx_hash: string;
  ledger: number;
  erp_posting_status: SettlementRow["erpPostingStatus"];
  settled_at: string;
};

function toProof(row: RawProof): ProofRow {
  return {
    payableId: row.payable_id,
    payableIdHash: row.payable_id_hash,
    proofHash: row.proof_hash,
    invoiceId: row.invoice_id,
    poId: row.po_id,
    vendorId: row.vendor_id,
    amount: row.amount,
    asset: row.asset,
    expiry: Number(row.expiry),
    status: row.status,
    registerTxHash: row.register_tx_hash ?? undefined,
  };
}

function toSettlement(row: RawSettlement): SettlementRow {
  return {
    payableId: row.payable_id,
    invoiceId: row.invoice_id,
    poId: row.po_id,
    proofHash: row.proof_hash,
    contractId: row.contract_id,
    asset: row.asset,
    amount: row.amount,
    txHash: row.tx_hash,
    ledger: Number(row.ledger),
    erpPostingStatus: row.erp_posting_status,
    settledAt: row.settled_at,
  };
}

export function createSettlementStore(db: Db) {
  return {
    upsertProof(proof: ProofRow): void {
      db.prepare(
        `INSERT INTO proofs (payable_id_hash, payable_id, proof_hash, invoice_id, po_id, vendor_id, amount, asset, expiry, status, register_tx_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (payable_id_hash) DO UPDATE SET
           proof_hash = excluded.proof_hash, invoice_id = excluded.invoice_id, po_id = excluded.po_id,
           vendor_id = excluded.vendor_id, amount = excluded.amount, asset = excluded.asset,
           expiry = excluded.expiry, status = excluded.status`,
      ).run(
        proof.payableIdHash,
        proof.payableId,
        proof.proofHash,
        proof.invoiceId,
        proof.poId,
        proof.vendorId,
        proof.amount,
        proof.asset,
        proof.expiry,
        proof.status,
        proof.registerTxHash ?? null,
      );
    },

    getProofByIdHash(payableIdHash: string): ProofRow | undefined {
      const row = db.prepare("SELECT * FROM proofs WHERE payable_id_hash = ?").get(payableIdHash) as RawProof | undefined;
      return row ? toProof(row) : undefined;
    },

    getProof(payableId: string): ProofRow | undefined {
      const row = db.prepare("SELECT * FROM proofs WHERE payable_id = ?").get(payableId) as RawProof | undefined;
      return row ? toProof(row) : undefined;
    },

    setProofStatus(payableIdHash: string, status: ProofStatus, registerTxHash?: string): void {
      db.prepare(
        "UPDATE proofs SET status = ?, register_tx_hash = COALESCE(?, register_tx_hash) WHERE payable_id_hash = ?",
      ).run(status, registerTxHash ?? null, payableIdHash);
    },

    listOpenRegistrations(): ProofRow[] {
      const rows = db.prepare("SELECT * FROM proofs WHERE status = 'REGISTERED' ORDER BY expiry").all() as RawProof[];
      return rows.map(toProof);
    },

    recordSettlement(settlement: SettlementRow): void {
      db.prepare(
        `INSERT INTO settlements (payable_id, invoice_id, po_id, proof_hash, contract_id, asset, amount, tx_hash, ledger, erp_posting_status, settled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (payable_id) DO NOTHING`,
      ).run(
        settlement.payableId,
        settlement.invoiceId,
        settlement.poId,
        settlement.proofHash,
        settlement.contractId,
        settlement.asset,
        settlement.amount,
        settlement.txHash,
        settlement.ledger,
        settlement.erpPostingStatus,
        settlement.settledAt,
      );
    },

    getSettlement(payableId: string): SettlementRow | undefined {
      const row = db.prepare("SELECT * FROM settlements WHERE payable_id = ?").get(payableId) as RawSettlement | undefined;
      return row ? toSettlement(row) : undefined;
    },

    listSettlements(): SettlementRow[] {
      const rows = db.prepare("SELECT * FROM settlements ORDER BY ledger, payable_id").all() as RawSettlement[];
      return rows.map(toSettlement);
    },

    setErpPostingStatus(payableId: string, status: SettlementRow["erpPostingStatus"]): void {
      db.prepare("UPDATE settlements SET erp_posting_status = ? WHERE payable_id = ?").run(status, payableId);
    },

    recordChainEvent(event: ChainEventRow): boolean {
      const result = db
        .prepare(
          `INSERT INTO chain_events (id, type, ledger, tx_hash, payable_id_hash, payload)
           VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
        )
        .run(event.id, event.type, event.ledger, event.txHash, event.payableIdHash ?? null, JSON.stringify(event.payload));
      return Number(result.changes) > 0;
    },

    listChainEvents(payableIdHash?: string): ChainEventRow[] {
      const rows = (
        payableIdHash
          ? db.prepare("SELECT * FROM chain_events WHERE payable_id_hash = ? ORDER BY ledger, id").all(payableIdHash)
          : db.prepare("SELECT * FROM chain_events ORDER BY ledger, id").all()
      ) as { id: string; type: string; ledger: number; tx_hash: string; payable_id_hash: string | null; payload: string }[];
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        ledger: Number(r.ledger),
        txHash: r.tx_hash,
        payableIdHash: r.payable_id_hash ?? undefined,
        payload: JSON.parse(r.payload) as Record<string, unknown>,
      }));
    },

    findChainEvent(payableIdHash: string, type: string): ChainEventRow | undefined {
      const row = db
        .prepare(
          "SELECT * FROM chain_events WHERE payable_id_hash = ? AND type = ? ORDER BY ledger DESC, id DESC LIMIT 1",
        )
        .get(payableIdHash, type) as
        | { id: string; type: string; ledger: number; tx_hash: string; payable_id_hash: string | null; payload: string }
        | undefined;
      if (!row) return undefined;
      return {
        id: row.id,
        type: row.type,
        ledger: Number(row.ledger),
        txHash: row.tx_hash,
        payableIdHash: row.payable_id_hash ?? undefined,
        payload: JSON.parse(row.payload) as Record<string, unknown>,
      };
    },

    getCursor(name: string): { cursor?: string; ledger?: number } | undefined {
      const row = db.prepare("SELECT cursor, ledger FROM indexer_cursors WHERE name = ?").get(name) as
        | { cursor: string | null; ledger: number | null }
        | undefined;
      if (!row) return undefined;
      return { cursor: row.cursor ?? undefined, ledger: row.ledger === null ? undefined : Number(row.ledger) };
    },

    setCursor(name: string, value: { cursor?: string; ledger?: number }): void {
      db.prepare(
        `INSERT INTO indexer_cursors (name, cursor, ledger) VALUES (?, ?, ?)
         ON CONFLICT (name) DO UPDATE SET cursor = excluded.cursor, ledger = excluded.ledger`,
      ).run(name, value.cursor ?? null, value.ledger ?? null);
    },

    addSettledFingerprint(fingerprint: string, note: string): void {
      addSettledFingerprint(db, fingerprint, note);
    },
  };
}

export type SqliteSettlementStore = ReturnType<typeof createSettlementStore>;
