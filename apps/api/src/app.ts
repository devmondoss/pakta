import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { Vendor, VendorWallet } from "@pakta/canonical-model";
import {
  addSettledFingerprint,
  attestWallet,
  AlreadySettledError,
  confirmReceipt,
  getSettlement,
  recordSettlement,
  registerWalletChange,
} from "@pakta/db";
import { buildProofOfPayable, ProofBuilderError } from "@pakta/proof-builder";
import { invoiceFingerprint } from "@pakta/rules-kernel";
import { createNvidiaExtractor, type InvoiceExtractor } from "@pakta/ai-extraction";
import Fastify from "fastify";
import { getDb } from "./db.js";
import { evaluateLive } from "./demoData.js";
import { ingestAndPersist, ingestPdfAndPersist, loadPolicy, seedIfEmpty } from "./ingest.js";
import { toApiPayable } from "./mapPayable.js";

function isPdf(filename: string, mimetype: string, buffer: Buffer): boolean {
  return mimetype === "application/pdf" || filename.toLowerCase().endsWith(".pdf") || buffer.subarray(0, 5).toString() === "%PDF-";
}

/**
 * `extractor` is injectable so tests can exercise the PDF path without a
 * network call; by default it's built lazily on the first PDF upload, so
 * a missing NVIDIA_API_KEY only fails PDF intake, never boot.
 */
export async function buildApp(opts: { extractor?: InvoiceExtractor } = {}) {
  let extractor = opts.extractor;
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  // @fastify/multipart defaults to 1 MB — too small for a real exported
  // invoice PDF. 20 MB covers scanned/multi-page invoices comfortably.
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  const db = await getDb();
  await seedIfEmpty(db);

  /**
   * The real intake endpoint. An uploaded `.xlsx` goes through
   * `ingestWorkbook` and every resulting payable gets persisted to
   * `@pakta/db`; a `.pdf` goes through AI extraction and is persisted only
   * if it resolves against a known vendor/PO. No fixture, no
   * re-derivation: whatever's in the DB after this call is exactly what
   * `GET /payables` will show.
   */
  app.post("/ingest", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "no file uploaded (expected multipart field)" });

    const buffer = await file.toBuffer();

    if (isPdf(file.filename, file.mimetype, buffer)) {
      try {
        extractor ??= createNvidiaExtractor();
        return { kind: "pdf", ...(await ingestPdfAndPersist(db, buffer, extractor)) };
      } catch (err) {
        request.log.error(err);
        return reply.code(422).send({ error: `could not extract invoice from PDF: ${(err as Error).message}` });
      }
    }

    try {
      return { kind: "workbook", ...(await ingestAndPersist(db, buffer)) };
    } catch (err) {
      return reply.code(400).send({ error: `could not parse workbook: ${(err as Error).message}` });
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.get("/policy", async () => loadPolicy());

  app.get("/payables", async () => {
    const { payables, results } = await evaluateLive(db);
    const byPayableId = new Map(results.map((r) => [r.payableId, r]));

    return Promise.all(
      payables.map(async (payable) => {
        const result = byPayableId.get(payable.payableId);
        if (!result) throw new Error(`no kernel result for ${payable.payableId}`);
        return toApiPayable(payable, result, await getSettlement(db, payable.payableId));
      }),
    );
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

  app.get<{ Params: { payableId: string } }>("/payables/:payableId/settlement", async (request, reply) => {
    const settlement = await getSettlement(db, request.params.payableId);
    if (!settlement) return reply.code(404).send({ error: `no settlement for ${request.params.payableId}` });
    return settlement;
  });

  /**
   * The other half of the Dev 1 <-> Dev 2 contract: `ProofOfPayable` flows
   * out via GET /payables/:id/proof, `Settlement` flows back in here once
   * the Settlement Adapter has actually executed the transfer on Stellar.
   * Refuses a payable that isn't READY (never trust a client-reported
   * settlement for something the kernel itself would still block) and
   * refuses a double-settle (`@pakta/db`'s `payable_id` primary key makes
   * that the actual source of truth, this just surfaces it as a 409).
   * Also feeds the settled fingerprint back into
   * `settled_invoice_fingerprints`, so a *different* payable for the same
   * vendor+amount correctly gets caught by the kernel's own
   * `PAYMENT_ALREADY_SETTLED` rule instead of slipping through.
   */
  app.post<{
    Params: { payableId: string };
    Body: { asset?: string; amount?: string; txHash?: string; ledger?: number; erpPostingStatus?: string };
  }>("/payables/:payableId/settlement", async (request, reply) => {
    const { payables, results } = await evaluateLive(db);
    const payable = payables.find((p) => p.payableId === request.params.payableId);
    const result = results.find((r) => r.payableId === request.params.payableId);
    if (!payable || !result) {
      return reply.code(404).send({ error: `no payable ${request.params.payableId}` });
    }
    if (result.status !== "READY") {
      return reply.code(409).send({ error: `${payable.payableId} is not READY, refusing to record a settlement` });
    }

    const poId = payable.purchaseOrder?.poId ?? payable.invoice.poId;
    const { asset, amount, txHash, ledger, erpPostingStatus } = request.body ?? {};
    if (!poId || !asset || !amount || !txHash || typeof ledger !== "number") {
      return reply.code(400).send({ error: "asset, amount, txHash, and ledger (number) are required" });
    }
    if (erpPostingStatus && !["PENDING", "RECONCILED", "FAILED"].includes(erpPostingStatus)) {
      return reply.code(400).send({ error: "erpPostingStatus must be PENDING, RECONCILED, or FAILED" });
    }

    try {
      const settlement = await recordSettlement(
        db,
        {
          payableId: payable.payableId,
          invoiceId: payable.invoice.invoiceId,
          poId,
          asset,
          amount,
          txHash,
          ledger,
          erpPostingStatus: erpPostingStatus as "PENDING" | "RECONCILED" | "FAILED" | undefined,
        },
        new Date(),
      );
      await addSettledFingerprint(db, invoiceFingerprint(payable), `settled via ${payable.payableId}`);
      return settlement;
    } catch (err) {
      if (err instanceof AlreadySettledError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
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

      const wallet = await registerWalletChange(db, request.params.vendorId, address, new Date());
      return wallet;
    },
  );

  /** HU-D2-15 step 2: a human confirms the wallet on file is really the vendor's. */
  app.post<{ Params: { vendorId: string } }>("/vendors/:vendorId/wallet/attest", async (request, reply) => {
    try {
      return await attestWallet(db, request.params.vendorId);
    } catch (err) {
      return reply.code(404).send({ error: (err as Error).message });
    }
  });

  /**
   * §25 maestro, Scene 4: "Operations confirms receipt for INV-005. Pakta
   * revalidates and pays." Payable-scoped (not PO-scoped) because that's
   * what the Exceptions module shows the owner — resolves to the
   * payable's PO under the hood.
   */
  app.post<{
    Params: { payableId: string };
    Body: { confirmedQty?: number; invoicedQty?: number; confirmedBy?: string };
  }>("/payables/:payableId/receipt", async (request, reply) => {
    const { payables } = await evaluateLive(db);
    const payable = payables.find((p) => p.payableId === request.params.payableId);
    if (!payable) return reply.code(404).send({ error: `no payable ${request.params.payableId}` });

    const poId = payable.purchaseOrder?.poId;
    if (!poId) return reply.code(400).send({ error: `${payable.payableId} has no purchase order to confirm receipt against` });

    const { confirmedQty, invoicedQty, confirmedBy } = request.body ?? {};
    const receipt = await confirmReceipt(
      db,
      poId,
      { confirmedQty, invoicedQty, confirmedBy: confirmedBy?.trim() || "ops@pakta.demo" },
      new Date(),
    );
    return receipt;
  });

  app.get("/summary", async () => {
    const { payables, results } = await evaluateLive(db);
    const byPayableId = new Map(results.map((r) => [r.payableId, r]));

    let totalRequested = 0;
    let totalReady = 0;
    let totalBlocked = 0;
    let totalSettled = 0;
    let readyCount = 0;
    let blockedCount = 0;
    let settledCount = 0;

    for (const p of payables) {
      const amount = Number(p.invoice.amount);
      totalRequested += amount;
      const result = byPayableId.get(p.payableId);

      if (await getSettlement(db, p.payableId)) {
        totalSettled += amount;
        settledCount++;
      } else if (result?.status === "READY") {
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
      totalSettled: totalSettled.toFixed(2),
      payableCount: payables.length,
      readyCount,
      blockedCount,
      settledCount,
    };
  });

  return app;
}
