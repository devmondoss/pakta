import path from "node:path";
import { buildApp } from "./app.js";

// Loads the monorepo root .env (NVIDIA_API_KEY, DATABASE_URL, etc.) —
// without this, running `pnpm dev` here needs the shell to already have
// those exported, which it won't unless you `source .env` by hand every time.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
} catch {
  // No .env file — fine in CI/hosted environments where these are real env vars already.
}

const port = Number(process.env.PORT ?? 4000);

const app = await buildApp();
await app.listen({ port, host: "0.0.0.0" });
