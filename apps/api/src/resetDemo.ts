import path from "node:path";
import { resetDb } from "@pakta/db";
import { getDb } from "./db.js";
import { seedIfEmpty } from "./ingest.js";

// Manual, pre-demo only: wipes whatever rehearsals left behind (confirmed
// receipts, changed wallets, uploaded PDFs, settlements) and reloads the
// canonical demo workbook through the normal ingest path. Never run by the
// server itself.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file — DATABASE_URL must already be in the environment.
}

const db = await getDb();
await resetDb(db);
await seedIfEmpty(db);
console.log(`demo data reset in schema "${db.schema}"`);
