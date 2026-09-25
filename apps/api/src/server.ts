import { buildApp } from "./app.js";
import { createSettlementServices } from "./settlement.js";
import { getDb } from "./db.js";

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
  const { chain } = createSettlementServices(getDb());
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
