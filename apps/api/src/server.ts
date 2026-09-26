import path from "node:path";
import { buildApp } from "./app.js";
import { createSettlementServices } from "./settlement.js";
import { getDb } from "./db.js";

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

/**
 * PAKTA_AGENT_INTERVAL_MS turns on the autonomous Settlement Agent: every
 * interval it catches up on chain events, sweeps lapsed registrations, and
 * settles whatever the kernel says is READY. Off by default — a server should
 * not start paying suppliers just because it booted.
 */
const interval = Number(process.env.PAKTA_AGENT_INTERVAL_MS ?? 0);
if (interval > 0) {
  const { chain } = createSettlementServices(await getDb());
  if (!chain) {
    app.log.warn("PAKTA_AGENT_INTERVAL_MS is set but settlement keys are not; the agent will not run");
  } else {
    app.log.info({ interval }, "settlement agent started");
    chain.agent.start(
      interval,
      (report) => app.log.info({ report }, "settlement agent cycle"),
      (error) => app.log.error({ err: error }, "settlement agent cycle failed"),
    );
  }
}
