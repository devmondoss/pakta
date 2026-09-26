import { Settlement } from "@pakta/canonical-model";
import type { Db } from "./db.js";
import { addSettledFingerprint } from "./fingerprints.js";

/**
 * Settlements and the settlement path's own state, on Postgres (Neon).
 *
 * Two surfaces over the same tables:
 *
 *   - `getSettlement` / `listSettlements` / `recordSettlement` return the
 *     shared v1.1 `Settlement` contract — what Dev 2 and the dashboard read.
 *   - `createSettlementStore` implements `@pakta/settlement`'s
 *     `SettlementStore` for the adapter, indexer and agent. Declared with
 *     local types rather than importing that package, so the database does
 *     not depend on the settlement package; the shapes match structurally and
 *     TypeScript checks that where they are wired together (apps/api).
 */

type SettlementRow = {
  payable_id: string;
  invoice_id: string;
  po_id: string;
  network: string;
  asset: string;
  amount: string;
  tx_hash: string;
  ledger: number;
  erp_posting_status: "PENDING" | "RECONCILED" | "FAILED";
  settled_at: string;
  proof_hash: string | null;
  contract_id: string | null;
};

/**
 * A row is only a Settlement if it can say which proof authorized it and
 * which gate it went through, and carries a real transaction hash. Rows
 * written before v1.1 — or recorded from an unverified client report — have
 * none of that, and are not reported as settled. Better to show a payable as
 * unpaid than to vouch for a payment nobody can trace.
 */
function toSettlement(row: SettlementRow): Settlement | undefined {
  const parsed = Settlement.safeParse({
    payable_id: row.payable_id,
    invoice_id: row.invoice_id,
    po_id: row.po_id,
    proof_hash: row.proof_hash,
    contract_id: row.contract_id,
    settlement: {
      network: "stellar",
      asset: row.asset,
      amount: row.amount,
      tx_hash: row.tx_hash,
      ledger: Number(row.ledger),
    },
    status: "SETTLED",
    erp_posting_status: row.erp_posting_status,
  });
  return parsed.success ? parsed.data : undefined;
}

export async function getSettlement(db: Db, payableId: string): Promise<Settlement | undefined> {
  const rows = (await db.query(`SELECT * FROM ${db.schema}.settlements WHERE payable_id = $1`, [
    payableId,
  ])) as SettlementRow[];
  return rows[0] ? toSettlement(rows[0]) : undefined;
}

export async function listSettlements(db: Db): Promise<Settlement[]> {
  const rows = (await db.query(`SELECT * FROM ${db.schema}.settlements ORDER BY ledger, payable_id`)) as SettlementRow[];
  return rows.map(toSettlement).filter((s): s is Settlement => s !== undefined);
}

export class AlreadySettledError extends Error {}

export type RecordSettlementInput = {
  payableId: string;
  invoiceId: string;
  poId: string;
  asset: string;
  amount: string;
  txHash: string;
  ledger: number;
  proofHash: string;
  contractId: string;
  erpPostingStatus?: "PENDING" | "RECONCILED" | "FAILED";
};

/**
 * Records a settlement once. A second record for the same payable, or a second
 * payable claiming the same transaction, is refused — the payable_id primary
 * key covers the first, the explicit tx_hash check the second.
 */
export async function recordSettlement(db: Db, input: RecordSettlementInput, now: Date): Promise<Settlement> {
  const candidate = Settlement.safeParse({
    payable_id: input.payableId,
    invoice_id: input.invoiceId,
    po_id: input.poId,
    proof_hash: input.proofHash,
    contract_id: input.contractId,
    settlement: { network: "stellar", asset: input.asset, amount: input.amount, tx_hash: input.txHash, ledger: input.ledger },
    status: "SETTLED",
    erp_posting_status: input.erpPostingStatus ?? "PENDING",
  });
  if (!candidate.success) {
    const problems = candidate.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`not a valid v1.1 Settlement — ${problems}`);
  }

  const existing = (await db.query(
    `SELECT payable_id, tx_hash FROM ${db.schema}.settlements WHERE payable_id = $1 OR tx_hash = $2`,
    [input.payableId, input.txHash],
  )) as { payable_id: string; tx_hash: string }[];
  if (existing.some((r) => r.payable_id === input.payableId)) {
    throw new AlreadySettledError(`payable ${input.payableId} is already settled`);
  }
  if (existing.length > 0) {
    throw new AlreadySettledError(`transaction ${input.txHash} already settled ${existing[0]!.payable_id}`);
  }

  await db.query(
    `INSERT INTO ${db.schema}.settlements
       (payable_id, invoice_id, po_id, network, asset, amount, tx_hash, ledger, erp_posting_status, settled_at, proof_hash, contract_id)
     VALUES ($1, $2, $3, 'stellar', $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.payableId,
      input.invoiceId,
      input.poId,
      input.asset,
      input.amount,
      input.txHash,
      input.ledger,
      input.erpPostingStatus ?? "PENDING",
      now.toISOString(),
      input.proofHash,
      input.contractId,
    ],
  );

  return candidate.data;
}

// ---------------------------------------------------------------------------
// SettlementStore for the adapter, indexer and agent.
// ---------------------------------------------------------------------------

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

export type SettlementRecordRow = {
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
  expiry: string | number;
  status: ProofStatus;
  register_tx_hash: string | null;
};

type RawEvent = {
  id: string;
  type: string;
  ledger: number;
  tx_hash: string;
  payable_id_hash: string | null;
  payload: string;
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
    // BIGINT comes back from the Neon driver as a string.
    expiry: Number(row.expiry),
    status: row.status,
    registerTxHash: row.register_tx_hash ?? undefined,
  };
}

function toRecord(row: SettlementRow): SettlementRecordRow | undefined {
  if (!row.proof_hash || !row.contract_id) return undefined;
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

function toEvent(row: RawEvent): ChainEventRow {
  return {
    id: row.id,
    type: row.type,
    ledger: Number(row.ledger),
    txHash: row.tx_hash,
    payableIdHash: row.payable_id_hash ?? undefined,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  };
}

export function createSettlementStore(db: Db) {
  const t = (table: string) => `${db.schema}.${table}`;

  return {
    async upsertProof(proof: ProofRow): Promise<void> {
      await db.query(
        `INSERT INTO ${t("proofs")}
           (payable_id_hash, payable_id, proof_hash, invoice_id, po_id, vendor_id, amount, asset, expiry, status, register_tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (payable_id_hash) DO UPDATE SET
           proof_hash = EXCLUDED.proof_hash, invoice_id = EXCLUDED.invoice_id, po_id = EXCLUDED.po_id,
           vendor_id = EXCLUDED.vendor_id, amount = EXCLUDED.amount, asset = EXCLUDED.asset,
           expiry = EXCLUDED.expiry, status = EXCLUDED.status`,
        [
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
        ],
      );
    },

    async getProofByIdHash(payableIdHash: string): Promise<ProofRow | undefined> {
      const rows = (await db.query(`SELECT * FROM ${t("proofs")} WHERE payable_id_hash = $1`, [payableIdHash])) as RawProof[];
      return rows[0] ? toProof(rows[0]) : undefined;
    },

    async getProof(payableId: string): Promise<ProofRow | undefined> {
      const rows = (await db.query(`SELECT * FROM ${t("proofs")} WHERE payable_id = $1`, [payableId])) as RawProof[];
      return rows[0] ? toProof(rows[0]) : undefined;
    },

    async setProofStatus(payableIdHash: string, status: ProofStatus, registerTxHash?: string): Promise<void> {
      await db.query(
        `UPDATE ${t("proofs")} SET status = $1, register_tx_hash = COALESCE($2, register_tx_hash) WHERE payable_id_hash = $3`,
        [status, registerTxHash ?? null, payableIdHash],
      );
    },

    async listOpenRegistrations(): Promise<ProofRow[]> {
      const rows = (await db.query(`SELECT * FROM ${t("proofs")} WHERE status = 'REGISTERED' ORDER BY expiry`)) as RawProof[];
      return rows.map(toProof);
    },

    /** Idempotent: a second write for the same payable is ignored, never duplicated. */
    async recordSettlement(record: SettlementRecordRow): Promise<void> {
      await db.query(
        `INSERT INTO ${t("settlements")}
           (payable_id, invoice_id, po_id, network, asset, amount, tx_hash, ledger, erp_posting_status, settled_at, proof_hash, contract_id)
         VALUES ($1, $2, $3, 'stellar', $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (payable_id) DO NOTHING`,
        [
          record.payableId,
          record.invoiceId,
          record.poId,
          record.asset,
          record.amount,
          record.txHash,
          record.ledger,
          record.erpPostingStatus,
          record.settledAt,
          record.proofHash,
          record.contractId,
        ],
      );
    },

    async getSettlement(payableId: string): Promise<SettlementRecordRow | undefined> {
      const rows = (await db.query(`SELECT * FROM ${t("settlements")} WHERE payable_id = $1`, [payableId])) as SettlementRow[];
      return rows[0] ? toRecord(rows[0]) : undefined;
    },

    async listSettlements(): Promise<SettlementRecordRow[]> {
      const rows = (await db.query(`SELECT * FROM ${t("settlements")} ORDER BY ledger, payable_id`)) as SettlementRow[];
      return rows.map(toRecord).filter((r): r is SettlementRecordRow => r !== undefined);
    },

    async setErpPostingStatus(payableId: string, status: SettlementRecordRow["erpPostingStatus"]): Promise<void> {
      await db.query(`UPDATE ${t("settlements")} SET erp_posting_status = $1 WHERE payable_id = $2`, [status, payableId]);
    },

    /** Returns false if the event was already recorded. */
    async recordChainEvent(event: ChainEventRow): Promise<boolean> {
      const rows = (await db.query(
        `INSERT INTO ${t("chain_events")} (id, type, ledger, tx_hash, payable_id_hash, payload)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [event.id, event.type, event.ledger, event.txHash, event.payableIdHash ?? null, JSON.stringify(event.payload)],
      )) as { id: string }[];
      return rows.length > 0;
    },

    async findChainEvent(payableIdHash: string, type: string): Promise<ChainEventRow | undefined> {
      const rows = (await db.query(
        `SELECT * FROM ${t("chain_events")} WHERE payable_id_hash = $1 AND type = $2 ORDER BY ledger DESC, id DESC LIMIT 1`,
        [payableIdHash, type],
      )) as RawEvent[];
      return rows[0] ? toEvent(rows[0]) : undefined;
    },

    async listChainEvents(payableIdHash?: string): Promise<ChainEventRow[]> {
      const rows = (
        payableIdHash
          ? await db.query(`SELECT * FROM ${t("chain_events")} WHERE payable_id_hash = $1 ORDER BY ledger, id`, [payableIdHash])
          : await db.query(`SELECT * FROM ${t("chain_events")} ORDER BY ledger, id`)
      ) as RawEvent[];
      return rows.map(toEvent);
    },

    async getCursor(name: string): Promise<{ cursor?: string; ledger?: number } | undefined> {
      const rows = (await db.query(`SELECT cursor, ledger FROM ${t("indexer_cursors")} WHERE name = $1`, [name])) as {
        cursor: string | null;
        ledger: number | null;
      }[];
      const row = rows[0];
      if (!row) return undefined;
      return { cursor: row.cursor ?? undefined, ledger: row.ledger === null ? undefined : Number(row.ledger) };
    },

    async setCursor(name: string, value: { cursor?: string; ledger?: number }): Promise<void> {
      await db.query(
        `INSERT INTO ${t("indexer_cursors")} (name, cursor, ledger) VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET cursor = EXCLUDED.cursor, ledger = EXCLUDED.ledger`,
        [name, value.cursor ?? null, value.ledger ?? null],
      );
    },

    async addSettledFingerprint(fingerprint: string, note: string): Promise<void> {
      await addSettledFingerprint(db, fingerprint, note);
    },
  };
}

export type PostgresSettlementStore = ReturnType<typeof createSettlementStore>;
