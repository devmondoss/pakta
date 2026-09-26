import type { Settlement } from "@pakta/canonical-model";
import type { Db } from "./db.js";

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
};

function toSettlement(row: SettlementRow): Settlement {
  return {
    payable_id: row.payable_id,
    invoice_id: row.invoice_id,
    po_id: row.po_id,
    settlement: {
      network: "stellar",
      asset: row.asset,
      amount: row.amount,
      tx_hash: row.tx_hash,
      ledger: row.ledger,
    },
    status: "SETTLED",
    erp_posting_status: row.erp_posting_status,
  };
}

export async function getSettlement(db: Db, payableId: string): Promise<Settlement | undefined> {
  const rows = (await db.query(`SELECT * FROM ${db.schema}.settlements WHERE payable_id = $1`, [
    payableId,
  ])) as SettlementRow[];
  return rows[0] ? toSettlement(rows[0]) : undefined;
}

export async function listSettlements(db: Db): Promise<Settlement[]> {
  const rows = (await db.query(`SELECT * FROM ${db.schema}.settlements`)) as SettlementRow[];
  return rows.map(toSettlement);
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
  erpPostingStatus?: "PENDING" | "RECONCILED" | "FAILED";
};

/** Dev 1's Settlement Adapter calls this once (idempotency is the point — a payable can never be recorded settled twice). */
export async function recordSettlement(db: Db, input: RecordSettlementInput, now: Date): Promise<Settlement> {
  if (await getSettlement(db, input.payableId)) {
    throw new AlreadySettledError(`payable ${input.payableId} is already settled`);
  }

  await db.query(
    `INSERT INTO ${db.schema}.settlements (payable_id, invoice_id, po_id, network, asset, amount, tx_hash, ledger, erp_posting_status, settled_at)
     VALUES ($1, $2, $3, 'stellar', $4, $5, $6, $7, $8, $9)`,
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
    ],
  );

  return (await getSettlement(db, input.payableId))!;
}

export class NoSettlementError extends Error {}

/**
 * Demo-only reconciliation step: the ERP posting is asynchronous in real
 * life (Dev 1's adapter reports `settled`, the ERP confirms later), so the
 * UI needs a way to move a settlement from PENDING to RECONCILED (or
 * FAILED) without re-running `recordSettlement`, which refuses a payable
 * that's already settled.
 */
export async function updateErpPostingStatus(
  db: Db,
  payableId: string,
  erpPostingStatus: "PENDING" | "RECONCILED" | "FAILED",
): Promise<Settlement> {
  if (!(await getSettlement(db, payableId))) {
    throw new NoSettlementError(`payable ${payableId} has no settlement to update`);
  }
  await db.query(`UPDATE ${db.schema}.settlements SET erp_posting_status = $2 WHERE payable_id = $1`, [
    payableId,
    erpPostingStatus,
  ]);
  return (await getSettlement(db, payableId))!;
}
