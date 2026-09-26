import { openDb, PUBLIC_SCHEMA, TEST_SCHEMA, type Db } from "@pakta/db";

let instance: Promise<Db> | undefined;

export function getDb(): Promise<Db> {
  instance ??= (async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set — get one at https://neon.tech");
    }
    // vitest sets process.env.VITEST — tests get their own schema so they
    // can never touch the real app's data even though both share one
    // Neon database.
    const schema = process.env.VITEST ? TEST_SCHEMA : PUBLIC_SCHEMA;
    return openDb(connectionString, schema);
  })();
  return instance;
}
