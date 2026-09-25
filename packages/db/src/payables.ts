import { CanonicalPayable } from "@pakta/canonical-model";
import type { Db } from "./db.js";

type PayableRow = { payable_id: string; data: string; ingested_at: string };

function toPayable(row: PayableRow): CanonicalPayable {
  // CanonicalPayable.parse (not just JSON.parse) — dates round-trip
  // through JSON as strings, and z.coerce.date() on the schema turns
  // them back into real Date objects the rules kernel can compare.
  return CanonicalPayable.parse(JSON.parse(row.data));
}

export async function listPayables(db: Db): Promise<CanonicalPayable[]> {
  const rows = (await db.query(`SELECT * FROM ${db.schema}.payables ORDER BY ingested_at`)) as PayableRow[];
  return rows.map(toPayable);
}

export async function getPayable(db: Db, payableId: string): Promise<CanonicalPayable | undefined> {
  const rows = (await db.query(`SELECT * FROM ${db.schema}.payables WHERE payable_id = $1`, [
    payableId,
  ])) as PayableRow[];
  return rows[0] ? toPayable(rows[0]) : undefined;
}

export async function countPayables(db: Db): Promise<number> {
  const rows = (await db.query(`SELECT count(*)::int AS count FROM ${db.schema}.payables`)) as { count: number }[];
  return rows[0]!.count;
}

/**
 * The real persistence step behind `POST /ingest`: every payable
 * `ingestWorkbook` produced gets written here, keyed by `payableId`.
 * Re-ingesting the same invoice (same payable_id) overwrites its row —
 * intentional, so correcting a bad upload doesn't require a separate
 * "delete" step.
 */
export async function upsertPayable(db: Db, payable: CanonicalPayable, now: Date): Promise<void> {
  await db.query(
    `INSERT INTO ${db.schema}.payables (payable_id, data, ingested_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (payable_id) DO UPDATE SET data = excluded.data, ingested_at = excluded.ingested_at`,
    [payable.payableId, JSON.stringify(payable), now.toISOString()],
  );
}
