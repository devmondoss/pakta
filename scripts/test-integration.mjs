import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Keep the shared pakta_test schema isolated: each project resets its tables.
// Run the DB-backed projects in separate, sequential Vitest processes.
if (!process.env.DATABASE_URL && existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for DB, API and MCP integration tests.");
  process.exit(1);
}

for (const project of ["db", "api", "mcp"]) {
  console.log(`integration ${project}`);
  const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--project", project, "--no-file-parallelism"], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
