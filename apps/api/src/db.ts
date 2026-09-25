import { mkdirSync } from "node:fs";
import path from "node:path";
import { openDb, type Db } from "@pakta/db";

const DEFAULT_PATH = path.resolve(import.meta.dirname, "../data/pakta.db");

let instance: Db | undefined;

/** `DB_PATH=:memory:` for tests — a fresh, empty DB per process. */
export function getDb(): Db {
  if (instance) return instance;

  const dbPath = process.env.DB_PATH ?? DEFAULT_PATH;
  if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });

  instance = openDb(dbPath);
  return instance;
}
