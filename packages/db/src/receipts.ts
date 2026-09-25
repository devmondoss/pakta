import type { Receipt } from "@pakta/canonical-model";
import type { Db } from "./db.js";

type ReceiptRow = {
  po_id: string;
  confirmed_qty: string;
  invoiced_qty: string | null;
  confirmed_by: string;
  confirmed_at: string;
};

function toReceipt(row: ReceiptRow): Receipt {
  return {
    poId: row.po_id,
    confirmedQty: Number(row.confirmed_qty),
    invoicedQty: row.invoiced_qty === null ? undefined : Number(row.invoiced_qty),
    confirmedBy: row.confirmed_by,
    confirmedAt: new Date(row.confirmed_at),
  };
}

export async function getReceipt(db: Db, poId: string): Promise<Receipt | undefined> {
  const rows = (await db.query(`SELECT * FROM ${db.schema}.receipts WHERE po_id = $1`, [poId])) as ReceiptRow[];
  return rows[0] ? toReceipt(rows[0]) : undefined;
}

/** Seeds from the fixture's own RECEIPTS sheet — only fills gaps, never overwrites a real confirmation. */
export async function seedReceiptIfAbsent(db: Db, receipt: Receipt): Promise<void> {
  await db.query(
    `INSERT INTO ${db.schema}.receipts (po_id, confirmed_qty, invoiced_qty, confirmed_by, confirmed_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (po_id) DO NOTHING`,
    [receipt.poId, receipt.confirmedQty, receipt.invoicedQty ?? null, receipt.confirmedBy, receipt.confirmedAt.toISOString()],
  );
}

/**
 * §25 maestro, Scene 4: "Operations confirms receipt for INV-005. Pakta
 * revalidates and pays." Defaults to a full 1/1 confirmation (matching
 * the fixture's own convention — receipts are tracked per PO, not
 * itemized to line quantities in week 1) unless the caller specifies
 * otherwise.
 */
export async function confirmReceipt(
  db: Db,
  poId: string,
  input: { confirmedQty?: number; invoicedQty?: number; confirmedBy: string },
  now: Date,
): Promise<Receipt> {
  const confirmedQty = input.confirmedQty ?? 1;
  const invoicedQty = input.invoicedQty ?? 1;

  await db.query(
    `INSERT INTO ${db.schema}.receipts (po_id, confirmed_qty, invoiced_qty, confirmed_by, confirmed_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (po_id) DO UPDATE SET
       confirmed_qty = excluded.confirmed_qty,
       invoiced_qty = excluded.invoiced_qty,
       confirmed_by = excluded.confirmed_by,
       confirmed_at = excluded.confirmed_at`,
    [poId, confirmedQty, invoicedQty, input.confirmedBy, now.toISOString()],
  );

  return (await getReceipt(db, poId))!;
}
