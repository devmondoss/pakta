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
