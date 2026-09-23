import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const packages = fileURLToPath(new URL("../packages/", import.meta.url));
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));

for (const entry of readdirSync(packages, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const config = fileURLToPath(new URL(`../packages/${entry.name}/tsconfig.json`, import.meta.url));
  if (!existsSync(config)) continue;
  process.stdout.write(`typecheck ${entry.name}\n`);
  const result = spawnSync(process.execPath, [tsc, "-p", config, "--noEmit"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
