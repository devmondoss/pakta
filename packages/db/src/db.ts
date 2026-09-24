import { DatabaseSync } from "node:sqlite";
import { SCHEMA } from "./schema.js";

export type Db = DatabaseSync;

/** `path` is a file path, or `:memory:` for tests / throwaway instances. */
export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}
