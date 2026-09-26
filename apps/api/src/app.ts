import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { Vendor, VendorWallet } from "@pakta/canonical-model";
import { attestWallet, confirmReceipt, registerWalletChange } from "@pakta/db";
import { buildProofOfPayable, ProofBuilderError } from "@pakta/proof-builder";
import { GateError, SettlementRefused, type Deployment } from "@pakta/settlement";
import { isAccountId, unitsToDecimal } from "@pakta/stellar-sdk-wrapper";
import Fastify from "fastify";
import { getDb } from "./db.js";
import { evaluateLive } from "./demoData.js";
import { ingestAndPersist, loadPolicy, seedIfEmpty } from "./ingest.js";
import { toApiPayable, type SettledInfo } from "./mapPayable.js";
import {
  createSettlementServices,
  explorerTxUrl,
  settlementContext,
  type ChainFactory,
  type SettlementServices,
} from "./settlement.js";

export type BuildAppOptions = {
  /** Overrides how the on-chain services are built — tests inject an in-memory gate here. */
  chain?: ChainFactory;
  deployment?: Deployment;
  now?: () => Date;
  logger?: boolean;
};

const CHAIN_DISABLED =
  "on-chain settlement is not configured: set PAKTA_ISSUER_SECRET and PAKTA_EXECUTOR_SECRET to enable it";

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  await app.register(cors, { origin: true });
  await app.register(multipart);

  const db = await getDb();
  await seedIfEmpty(db);
  const now = options.now ?? (() => new Date());
  const settlement: SettlementServices = createSettlementServices(db, {
    deployment: options.deployment,
    chain: options.chain,
    now,
  });
  const { store, deployment } = settlement;
  /**
   * The real intake endpoint — an uploaded `.xlsx` goes through
   * `ingestWorkbook` and every resulting payable gets persisted to
   * `@pakta/db`. No fixture, no re-derivation: whatever's in the DB
   * after this call is exactly what `GET /payables` will show.
   */
  app.post("/ingest", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "no file uploaded (expected multipart field)" });

    const buffer = await file.toBuffer();
    try {
      const outcome = await ingestAndPersist(db, buffer);
      return outcome;
    } catch (err) {
      return reply.code(400).send({ error: `could not parse workbook: ${(err as Error).message}` });
    }
  });
  async function settledInfo(payableId: string): Promise<SettledInfo | undefined> {
    const record = await store.getSettlement(payableId);
    if (!record) return undefined;
    return {
      txHash: record.txHash,
      ledger: record.ledger,
      proofHash: record.proofHash,
      explorerUrl: explorerTxUrl(deployment, record.txHash),
      network: deployment.network,
      erpPostingStatus: record.erpPostingStatus,
    };
  }

  app.get("/health", async () => ({
    status: "ok",
    network: deployment.network,
    gate: deployment.contractId,
    settlement: settlement.chain ? "enabled" : "disabled",
  }));

  app.get("/policy", async () => loadPolicy());

  app.get("/payables", async () => {
    const { payables, results } = await evaluateLive(db, now());
    const byPayableId = new Map(results.map((r) => [r.payableId, r]));

    return Promise.all(
      payables.map(async (payable) => {
        const result = byPayableId.get(payable.payableId);
        if (!result) throw new Error(`no kernel result for ${payable.payableId}`);
        return toApiPayable(payable, result, await settledInfo(payable.payableId));
      }),
    );
  });

  app.get<{ Params: { payableId: string } }>("/payables/:payableId/proof", async (request, reply) => {
    const { payables, results } = await evaluateLive(db, now());
    const payable = payables.find((p) => p.payableId === request.params.payableId);
    const result = results.find((r) => r.payableId === request.params.payableId);
    if (!payable || !result) {
      return reply.code(404).send({ error: `no payable ${request.params.payableId}` });
    }

    try {
      return buildProofOfPayable(payable, result, now());
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
    const { payables, results } = await evaluateLive(db, now());
    const payable = payables.find((p) => p.payableId === request.params.payableId);
    const result = results.find((r) => r.payableId === request.params.payableId);
    if (!payable || !result) {
      return reply.code(404).send({ error: `no payable ${request.params.payableId}` });
    }
    return toApiPayable(payable, result, await settledInfo(payable.payableId));
  });

  /**
   * Settles one payable on Stellar.
   *
   * The kernel is re-run first, against the live state, at the moment of
   * settling (§14.3) — a payable that was READY when the page loaded but whose
   * vendor wallet changed since is refused here, not paid. Only then is a
   * fresh proof built and signed, and the adapter takes it on-chain. The
   * request carries no amount and no destination: those come from the proof.
   */
  app.post<{ Params: { payableId: string } }>("/payables/:payableId/settle", async (request, reply) => {
    const payableId = request.params.payableId;
    const existing = await settledInfo(payableId);
    if (existing) return { status: "ALREADY_SETTLED", payableId, settlement: existing };

    if (!settlement.chain) return reply.code(503).send({ error: CHAIN_DISABLED });

    const at = now();
    const { payables, results } = await evaluateLive(db, at);
    const payable = payables.find((p) => p.payableId === payableId);
    const result = results.find((r) => r.payableId === payableId);
    if (!payable || !result) return reply.code(404).send({ error: `no payable ${payableId}` });

    if (result.status !== "READY") {
      return reply.code(409).send({
        error: `${payableId} is not payable right now`,
        exception: toApiPayable(payable, result).exception,
      });
    }

    try {
      const proof = buildProofOfPayable(payable, result, at);
      const { signed } = settlement.chain.issuer.sign(proof, deployment);
      const outcome = await settlement.chain.adapter.settle(signed, settlementContext(payable));
      if (outcome.status === "ALREADY_SETTLED") {
        return { status: "ALREADY_SETTLED", payableId, settlement: await settledInfo(payableId) };
      }
      return {
        status: "SETTLED",
        payableId,
        settlement: outcome.settlement,
        explorerUrl: explorerTxUrl(deployment, outcome.settleTx.txHash),
        registerTx: outcome.registerTx?.txHash,
      };
    } catch (err) {
      if (err instanceof SettlementRefused) {
        return reply.code(409).send({ error: err.message, reason: err.reason });
      }
      if (err instanceof ProofBuilderError) return reply.code(409).send({ error: err.message });
      throw err;
    }
  });

  /**
   * Cancels a registered payable before it settles — the on-chain brake for
   * evidence that went stale. The issuer signs the cancellation, reason
   * included, so the event records the issuer's justification.
   */
  app.post<{ Params: { payableId: string }; Body: { reason?: string } }>(
    "/payables/:payableId/revoke",
    async (request, reply) => {
      if (!settlement.chain) return reply.code(503).send({ error: CHAIN_DISABLED });
      const reason = request.body?.reason?.trim();
      if (!reason) return reply.code(400).send({ error: "reason is required" });

      const proof = await store.getProof(request.params.payableId);
      if (!proof) return reply.code(404).send({ error: `${request.params.payableId} was never registered by this backend` });

      const signature = settlement.chain.issuer.signRevocation(proof.payableId, proof.proofHash, reason, deployment);
      try {
        const tx = await settlement.chain.gate.revokePayable(proof.payableIdHash, reason, [
          { issuerPublicKeyHex: settlement.chain.issuer.publicKeyHex, signature },
        ]);
        await store.setProofStatus(proof.payableIdHash, "REVOKED");
        return { status: "REVOKED", payableId: proof.payableId, reason, txHash: tx.txHash, explorerUrl: explorerTxUrl(deployment, tx.txHash) };
      } catch (err) {
        if (err instanceof GateError) return reply.code(409).send({ error: err.message, code: err.code });
        throw err;
      }
    },
  );

  app.get("/settlements", async () =>
    (await store.listSettlements()).map((s) => ({ ...s, explorerUrl: explorerTxUrl(deployment, s.txHash) })),
  );

  /**
   * The reconciliation chain of `Pakta_Documento_Maestro.md` §25, for one
   * payable: the Stellar transaction, the settlement it produced, the proof
   * that authorized it, and the raw on-chain events — each pointing at the
   * next, so an auditor can walk from money back to the invoice.
   */
  app.get<{ Params: { payableId: string } }>("/settlements/:payableId", async (request, reply) => {
    const record = await store.getSettlement(request.params.payableId);
    const proof = await store.getProof(request.params.payableId);
    if (!record && !proof) return reply.code(404).send({ error: `nothing on record for ${request.params.payableId}` });
    return {
      settlement: record ? { ...record, explorerUrl: explorerTxUrl(deployment, record.txHash) } : undefined,
      proof,
      events: proof ? await store.listChainEvents(proof.payableIdHash) : [],
    };
  });

  /** Reconciliation export back to the spreadsheet world the SME already lives in. */
  app.get("/reconciliation.csv", async (_request, reply) => {
    const header = [
      "payable_id",
      "invoice_id",
      "po_id",
      "amount",
      "asset",
      "tx_hash",
      "ledger",
      "proof_hash",
      "contract_id",
      "erp_posting_status",
      "settled_at",
      "explorer_url",
    ];
    const quote = (v: string | number) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = (await store.listSettlements()).map((s) =>
      [
        s.payableId,
        s.invoiceId,
        s.poId,
        s.amount,
        s.asset,
        s.txHash,
        s.ledger,
        s.proofHash,
        s.contractId,
        s.erpPostingStatus,
        s.settledAt,
        explorerTxUrl(deployment, s.txHash),
      ]
        .map(quote)
        .join(","),
    );
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="pakta-reconciliation.csv"');
    return `${[header.join(","), ...rows].join("\n")}\n`;
  });

  /** What the vault holds, what is promised, and what could still leave. */
  app.get("/vault", async (_request, reply) => {
    if (!settlement.chain) return reply.code(503).send({ error: CHAIN_DISABLED });
    const [committed, available] = await Promise.all([
      settlement.chain.gate.getCommitted(),
      settlement.chain.gate.getAvailable(),
    ]);
    return {
      network: deployment.network,
      contractId: deployment.contractId,
      asset: deployment.assetCode,
      committed: unitsToDecimal(committed),
      available: unitsToDecimal(available),
      settledCount: (await store.listSettlements()).length,
    };
  });

  /** Runs one Settlement Agent cycle on demand — the same cycle the background loop runs. */
  app.post("/agent/run", async (_request, reply) => {
    if (!settlement.chain) return reply.code(503).send({ error: CHAIN_DISABLED });
    return settlement.chain.agent.runOnce();
  });

  app.get<{ Params: { payableId: string } }>("/payables/:payableId/settlement", async (request, reply) => {
    const record = await store.getSettlement(request.params.payableId);
    if (!record) return reply.code(404).send({ error: `no settlement for ${request.params.payableId}` });
    return { ...record, explorerUrl: explorerTxUrl(deployment, record.txHash) };
  });

  app.get("/vendors", async () => {
    const { payables } = await evaluateLive(db, now());
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
      // Checksum included. Accepting a malformed address here would let a
      // vendor's payables clear every rule and still be impossible to settle —
      // the proof builder would refuse them at the very last step.
      if (!isAccountId(address)) {
        return reply.code(400).send({ error: `${address} is not a valid Stellar account id (G..., 56 characters)` });
      }

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
    const { payables, results } = await evaluateLive(db, now());
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

      if (await store.getSettlement(p.payableId)) {
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
