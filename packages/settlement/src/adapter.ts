import { Settlement, type SignedProofOfPayable } from "@pakta/canonical-model";
import { decodeAccountId, unitsToDecimal } from "@pakta/stellar-sdk-wrapper";
import { GateError, type GateClient, type OnChainPayable, type SubmittedTx } from "./chain.js";
import type { Deployment } from "./deployment.js";
import { verifySignedProof } from "./issuer.js";
import type { PreparedRegistration } from "./registration.js";
import type { SettlementStore } from "./store.js";

/**
 * A proof that expires within this many seconds is not submitted. Registration
 * and settlement are two ledgers apart at best; a proof that lapses in between
 * would commit the float, fail to settle, and sit there until swept.
 */
export const MIN_REMAINING_VALIDITY_SECONDS = 120;

export class SettlementRefused extends Error {
  constructor(
    message: string,
    readonly reason:
      | "STALE_PROOF"
      | "ALREADY_CLOSED"
      | "ONCHAIN_MISMATCH"
      | "INVALID_PROOF"
      | "GATE_REFUSED",
  ) {
    super(message);
    this.name = "SettlementRefused";
  }
}

export type SettlementContext = {
  /** Not part of the proof, but part of the Settlement record Dev 2 reads back. */
  invoiceId: string;
  poId: string;
  /** `vendorId|amount`, the kernel's invoice fingerprint. */
  fingerprint: string;
};

export type SettlementOutcome =
  | {
      status: "SETTLED";
      settlement: Settlement;
      registerTx?: SubmittedTx;
      settleTx: SubmittedTx;
    }
  | {
      /** A previous attempt (or a racing process) already paid it. Not an error, and nothing was paid twice. */
      status: "ALREADY_SETTLED";
      settlement?: Settlement;
    };

type Clock = () => Date;

/**
 * Takes a signed Proof-of-Payable all the way to money on the vendor's
 * account, idempotently.
 *
 * The chain is the source of truth for idempotency. Before acting the adapter
 * reads the payable's on-chain state and does only what is still missing:
 *
 *   absent    -> register, then settle
 *   READY     -> settle
 *   SETTLED   -> nothing; report ALREADY_SETTLED
 *   EXPIRED / REVOKED -> refuse
 *
 * A retry after a crash, a timeout that actually landed, or two processes
 * settling the same payable all converge on one payment — and if they ever did
 * not, the contract itself refuses a second settle.
 */
export class SettlementAdapter {
  readonly #gate: GateClient;
  readonly #store: SettlementStore;
  readonly #deployment: Deployment;
  readonly #now: Clock;

  constructor(options: { gate: GateClient; store: SettlementStore; deployment: Deployment; now?: Clock }) {
    this.#gate = options.gate;
    this.#store = options.store;
    this.#deployment = options.deployment;
    this.#now = options.now ?? (() => new Date());
  }

  async settle(signed: SignedProofOfPayable, context: SettlementContext): Promise<SettlementOutcome> {
    const prepared = this.#verify(signed);
    this.#rememberProof(signed, prepared, context);

    let onChain = await this.#gate.getPayable(prepared.payableIdHash);
    let registerTx: SubmittedTx | undefined;

    if (onChain?.status === "SETTLED") return this.#alreadySettled(signed, prepared, context);
    if (onChain?.status === "EXPIRED" || onChain?.status === "REVOKED") {
      this.#store.setProofStatus(prepared.payableIdHash, onChain.status);
      throw new SettlementRefused(
        `${signed.payable_id} is ${onChain.status} on-chain and can no longer be settled`,
        "ALREADY_CLOSED",
      );
    }

    if (!onChain) {
      this.#assertFresh(prepared);
      try {
        registerTx = await this.#gate.registerPayable(prepared, this.#signatures(signed));
      } catch (error) {
        // Someone registered it between our read and our write. Fine — re-read
        // and carry on from whatever state it is in now.
        if (!(error instanceof GateError && error.code === "PayableAlreadyExists")) throw this.#refusal(error);
      }
      onChain = await this.#gate.getPayable(prepared.payableIdHash);
      if (!onChain) throw new SettlementRefused(`${signed.payable_id} did not appear on-chain after registering`, "GATE_REFUSED");
      this.#store.setProofStatus(prepared.payableIdHash, "REGISTERED", registerTx?.txHash);
      if (onChain.status === "SETTLED") return this.#alreadySettled(signed, prepared, context);
    }

    this.#assertMatches(signed.payable_id, prepared, onChain);

    let settleTx: SubmittedTx;
    try {
      settleTx = await this.#gate.settle(prepared.payableIdHash);
    } catch (error) {
      if (error instanceof GateError && error.code === "NotReady") {
        const now = await this.#gate.getPayable(prepared.payableIdHash);
        if (now?.status === "SETTLED") return this.#alreadySettled(signed, prepared, context);
      }
      throw this.#refusal(error);
    }

    const settlement = Settlement.parse({
      payable_id: signed.payable_id,
      invoice_id: context.invoiceId,
      po_id: context.poId,
      proof_hash: prepared.proofHash,
      contract_id: this.#deployment.contractId,
      settlement: {
        network: "stellar",
        asset: signed.asset,
        amount: signed.amount,
        tx_hash: settleTx.txHash,
        ledger: settleTx.ledger,
      },
      status: "SETTLED",
      erp_posting_status: "PENDING",
    });

    this.#store.recordSettlement({
      payableId: signed.payable_id,
      invoiceId: context.invoiceId,
      poId: context.poId,
      proofHash: prepared.proofHash,
      contractId: this.#deployment.contractId,
      asset: signed.asset,
      amount: signed.amount,
      txHash: settleTx.txHash,
      ledger: settleTx.ledger,
      erpPostingStatus: "PENDING",
      settledAt: this.#now().toISOString(),
    });
    this.#store.setProofStatus(prepared.payableIdHash, "SETTLED");
    this.#store.addSettledFingerprint(context.fingerprint, `${signed.payable_id} settled in ${settleTx.txHash}`);

    return { status: "SETTLED", settlement, registerTx, settleTx };
  }

  #verify(signed: SignedProofOfPayable): PreparedRegistration {
    try {
      return verifySignedProof(signed, this.#deployment);
    } catch (error) {
      throw new SettlementRefused(`proof for ${signed.payable_id} failed verification: ${(error as Error).message}`, "INVALID_PROOF");
    }
  }

  #signatures(signed: SignedProofOfPayable) {
    return [
      {
        // The envelope carries the issuer as a G... StrKey; the contract wants the raw key.
        issuerPublicKeyHex: Buffer.from(decodeAccountId(signed.issuer_public_key)).toString("hex"),
        signature: new Uint8Array(Buffer.from(signed.issuer_signature, "base64")),
      },
    ];
  }

  /** §14.3: revalidate at execution time. A proof about to lapse is not worth committing the float for. */
  #assertFresh(prepared: PreparedRegistration): void {
    const remaining = prepared.expiry - Math.floor(this.#now().getTime() / 1000);
    if (remaining < MIN_REMAINING_VALIDITY_SECONDS) {
      throw new SettlementRefused(
        `${prepared.payableId} expires in ${remaining}s — too close to settle safely; issue a fresh proof`,
        "STALE_PROOF",
      );
    }
  }

  /**
   * What is on-chain must be exactly what this proof says. The contract would
   * never accept a different registration under the same id without an issuer
   * signature for it, but the adapter checks rather than assumes.
   */
  #assertMatches(payableId: string, prepared: PreparedRegistration, onChain: OnChainPayable): void {
    const mismatches: string[] = [];
    if (onChain.proofHash !== prepared.proofHash) mismatches.push("proof_hash");
    if (onChain.recipient !== prepared.recipient) mismatches.push("recipient");
    if (onChain.amount !== prepared.amountUnits) mismatches.push("amount");
    if (onChain.expiry !== prepared.expiry) mismatches.push("expiry");
    if (mismatches.length > 0) {
      throw new SettlementRefused(
        `${payableId} is registered on-chain with a different ${mismatches.join(", ")} than this proof — refusing to settle`,
        "ONCHAIN_MISMATCH",
      );
    }
  }

  /**
   * Nothing is paid twice — but the local record may be missing. That happens
   * when the settle landed and its response was lost, or when the indexer saw
   * the settlement event before this backend knew the proof (it cannot
   * attribute an event to a payable it has never heard of, and it deduplicates
   * events, so it will not look again). The recorded event carries the
   * transaction and ledger, so the settlement is rebuilt from the chain rather
   * than left unrecorded.
   */
  #alreadySettled(
    signed: SignedProofOfPayable,
    prepared: PreparedRegistration,
    context: SettlementContext,
  ): SettlementOutcome {
    this.#store.setProofStatus(prepared.payableIdHash, "SETTLED");
    let record = this.#store.getSettlement(signed.payable_id);

    if (!record) {
      const event = this.#store.findChainEvent(prepared.payableIdHash, "settlement_executed");
      if (event) {
        this.#store.recordSettlement({
          payableId: signed.payable_id,
          invoiceId: context.invoiceId,
          poId: context.poId,
          proofHash: prepared.proofHash,
          contractId: this.#deployment.contractId,
          asset: signed.asset,
          amount: signed.amount,
          txHash: event.txHash,
          ledger: event.ledger,
          erpPostingStatus: "PENDING",
          settledAt: this.#now().toISOString(),
        });
        this.#store.addSettledFingerprint(context.fingerprint, `${signed.payable_id} settled in ${event.txHash}`);
        record = this.#store.getSettlement(signed.payable_id);
      }
    }

    return {
      status: "ALREADY_SETTLED",
      settlement: record
        ? Settlement.parse({
            payable_id: record.payableId,
            invoice_id: record.invoiceId,
            po_id: record.poId,
            proof_hash: record.proofHash,
            contract_id: record.contractId,
            settlement: {
              network: "stellar",
              asset: record.asset,
              amount: record.amount,
              tx_hash: record.txHash,
              ledger: record.ledger,
            },
            status: "SETTLED",
            erp_posting_status: record.erpPostingStatus,
          })
        : undefined,
    };
  }

  #rememberProof(signed: SignedProofOfPayable, prepared: PreparedRegistration, context: SettlementContext): void {
    const existing = this.#store.getProofByIdHash(prepared.payableIdHash);
    if (existing && existing.status !== "SIGNED") return;
    this.#store.upsertProof({
      payableId: signed.payable_id,
      payableIdHash: prepared.payableIdHash,
      proofHash: prepared.proofHash,
      invoiceId: context.invoiceId,
      poId: context.poId,
      vendorId: signed.vendor_id,
      amount: unitsToDecimal(prepared.amountUnits),
      asset: signed.asset,
      expiry: prepared.expiry,
      status: "SIGNED",
    });
  }

  #refusal(error: unknown): Error {
    if (error instanceof GateError) return new SettlementRefused(error.message, "GATE_REFUSED");
    return error instanceof Error ? error : new Error(String(error));
  }
}
