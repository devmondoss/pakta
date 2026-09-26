import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * Typechecks every workspace under packages/ and apps/ by calling tsc directly.
 *
 * Deliberately not `pnpm --filter ... exec tsc`: on this repo, starting pnpm 12
 * can rewrite pnpm-lock.yaml as a side effect, so a read-only check should not
 * go through it.
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));

for (const group of ["packages", "apps"]) {
  const dir = fileURLToPath(new URL(`../${group}/`, import.meta.url));
  if (!existsSync(dir)) continue;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const config = fileURLToPath(new URL(`../${group}/${entry.name}/tsconfig.json`, import.meta.url));
    if (!existsSync(config)) continue;

    // Next.js 16 generates route types (LayoutProps, PageProps) into .next/types,
    // which the app's tsconfig includes. On a fresh clone that directory does not
    // exist yet, so plain tsc fails with "Cannot find name 'LayoutProps'".
    const next = fileURLToPath(
      new URL(`../${group}/${entry.name}/node_modules/next/dist/bin/next`, import.meta.url),
    );
    if (existsSync(next)) {
      const typegen = spawnSync(process.execPath, [next, "typegen"], {
        cwd: fileURLToPath(new URL(`../${group}/${entry.name}/`, import.meta.url)),
        stdio: "ignore",
      });
      if (typegen.status !== 0) {
        process.stderr.write(`next typegen failed for ${group}/${entry.name}\n`);
        process.exit(typegen.status ?? 1);
      }
    }

    process.stdout.write(`typecheck ${group}/${entry.name}\n`);
    const result = spawnSync(process.execPath, [tsc, "-p", config, "--noEmit"], {
      cwd: root,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
