import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { schemaStatements, TABLE_NAMES } from "./schema.js";

export type Db = {
  query: NeonQueryFunction<false, false>["query"];
  schema: string;
};

/** Every real deployment of the app must use this — never `"pakta_test"` outside test code. */
export const PUBLIC_SCHEMA = "public";
/** The one schema every test file targets, so tests can never touch the real app's data even though they share one Neon database. */
export const TEST_SCHEMA = "pakta_test";

/**
 * Neon's HTTP driver, not `pg`/raw TCP: each query is one stateless HTTPS
 * request, which works everywhere plain TCP:5432 might not (sandboxed
 * environments, some corporate networks) and needs no connection-pool
 * lifecycle management for a service this size.
 *
 * `schema` isn't passed via the connection string's `options=-c
 * search_path=...` — verified that Neon's HTTP driver doesn't honor it
 * (every query still landed in `public` regardless). Every table
 * reference is schema-qualified in the SQL text instead.
 */
export async function openDb(connectionString: string, schema: string = PUBLIC_SCHEMA): Promise<Db> {
  const sql = neon(connectionString);
  if (schema !== PUBLIC_SCHEMA) {
    await sql.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  }
  for (const statement of schemaStatements(schema)) {
    await sql.query(statement);
  }
  return { query: sql.query.bind(sql), schema };
}

/** Demo/test reset only. Never called on boot; the API permits it solely for an explicit testnet demo run. */
export async function resetDb(db: Db): Promise<void> {
  // One Postgres statement instead of a network round-trip per table. The
  // demo reset runs against Neon, where nine sequential TRUNCATE calls made
  // a supposedly instant "start from zero" take tens of seconds.
  await db.query(`TRUNCATE TABLE ${TABLE_NAMES.map((table) => `${db.schema}.${table}`).join(", ")}`);
}
