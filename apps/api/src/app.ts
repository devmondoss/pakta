import cors from "@fastify/cors";
import type { Vendor, VendorWallet } from "@pakta/canonical-model";
import { attestWallet, registerWalletChange } from "@pakta/db";
import { buildProofOfPayable, ProofBuilderError } from "@pakta/proof-builder";
import Fastify from "fastify";
import { getDb } from "./db.js";
import { evaluateLive, seedFromFixture } from "./demoData.js";
import { toApiPayable } from "./mapPayable.js";

export async function buildApp() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });

  const db = getDb();
  await seedFromFixture(db);

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/payables", async () => {
    const { payables, results } = await evaluateLive(db);
    const byPayableId = new Map(results.map((r) => [r.payableId, r]));

    return payables.map((payable) => {
      const result = byPayableId.get(payable.payableId);
      if (!result) throw new Error(`no kernel result for ${payable.payableId}`);
      return toApiPayable(payable, result);
    });
  });

  app.get<{ Params: { payableId: string } }>("/payables/:payableId/proof", async (request, reply) => {
    const { payables, results } = await evaluateLive(db);
    const payable = payables.find((p) => p.payableId === request.params.payableId);
    const result = results.find((r) => r.payableId === request.params.payableId);
    if (!payable || !result) {
      return reply.code(404).send({ error: `no payable ${request.params.payableId}` });
    }

    try {
      return buildProofOfPayable(payable, result, new Date());
    } catch (err) {
      if (err instanceof ProofBuilderError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  /**
   * HU-D2-14's revalidation endpoint: re-runs the kernel against the
   * payable's *current* state (live wallet + fingerprints from
   * `@pakta/db`) and returns the fresh result. Nothing here is cached
   * stale — `GET /payables` already recomputes live — but this gives the
   * dashboard an explicit, discoverable "revalidate" action instead of
   * relying on a background poll of the list endpoint.
   */
  app.post<{ Params: { payableId: string } }>("/payables/:payableId/revalidate", async (request, reply) => {
    const { payables, results } = await evaluateLive(db);
    const payable = payables.find((p) => p.payableId === request.params.payableId);
    const result = results.find((r) => r.payableId === request.params.payableId);
    if (!payable || !result) {
      return reply.code(404).send({ error: `no payable ${request.params.payableId}` });
    }
    return toApiPayable(payable, result);
  });

  app.get("/vendors", async () => {
    const { payables } = await evaluateLive(db);
    const seen = new Map<string, { vendor: Vendor; wallet?: VendorWallet }>();
    for (const p of payables) {
      if (!seen.has(p.vendor.vendorId)) seen.set(p.vendor.vendorId, { vendor: p.vendor, wallet: p.vendorWallet });
    }
    return [...seen.values()].map(({ vendor, wallet }) => ({
      vendorId: vendor.vendorId,
      legalName: vendor.legalName,
      verificationStatus: vendor.verificationStatus,
      wallet: wallet
        ? { address: wallet.address, attestationStatus: wallet.attestationStatus, version: wallet.version }
        : undefined,
    }));
  });

  /** HU-D2-15 step 1: the vendor claims a new payout address — recorded UNATTESTED. */
  app.post<{ Params: { vendorId: string }; Body: { address?: string } }>(
    "/vendors/:vendorId/wallet",
    async (request, reply) => {
      const address = request.body?.address?.trim();
      if (!address) return reply.code(400).send({ error: "address is required" });

      const wallet = registerWalletChange(db, request.params.vendorId, address, new Date());
      return wallet;
    },
  );

  /** HU-D2-15 step 2: a human confirms the wallet on file is really the vendor's. */
  app.post<{ Params: { vendorId: string } }>("/vendors/:vendorId/wallet/attest", async (request, reply) => {
    try {
      return attestWallet(db, request.params.vendorId);
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  app.get("/summary", async () => {
    const { payables, results } = await evaluateLive(db);
    const byPayableId = new Map(results.map((r) => [r.payableId, r]));

    let totalRequested = 0;
    let totalReady = 0;
    let totalBlocked = 0;
    let readyCount = 0;
    let blockedCount = 0;

    for (const p of payables) {
      const amount = Number(p.invoice.amount);
      totalRequested += amount;
      const result = byPayableId.get(p.payableId);
      if (result?.status === "READY") {
        totalReady += amount;
        readyCount++;
      } else {
        totalBlocked += amount;
        blockedCount++;
      }
    }

    return {
      totalRequested: totalRequested.toFixed(2),
      totalReady: totalReady.toFixed(2),
      totalBlocked: totalBlocked.toFixed(2),
      payableCount: payables.length,
      readyCount,
      blockedCount,
    };
  });

  return app;
}
