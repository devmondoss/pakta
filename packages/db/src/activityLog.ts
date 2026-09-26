import { ACTIVITY_LOG_TABLE } from "./schema.js";
import type { Db } from "./db.js";

export type ActivityEntry = { id: number; occurredAt: string; message: string };

type ActivityRow = { id: number; occurred_at: string; message: string };

/** A real event, logged once, from whichever endpoint actually did something — never a canned/demo message. */
export async function logActivity(db: Db, message: string, occurredAt: Date = new Date()): Promise<void> {
  await db.query(`INSERT INTO ${db.schema}.${ACTIVITY_LOG_TABLE} (occurred_at, message) VALUES ($1, $2)`, [
    occurredAt.toISOString(),
    message,
  ]);
}

export async function listActivity(db: Db, limit = 10): Promise<ActivityEntry[]> {
  const rows = (await db.query(
    `SELECT id, occurred_at, message FROM ${db.schema}.${ACTIVITY_LOG_TABLE} ORDER BY id DESC LIMIT $1`,
    [limit],
  )) as ActivityRow[];
  return rows.map((r) => ({ id: r.id, occurredAt: r.occurred_at, message: r.message }));
}
