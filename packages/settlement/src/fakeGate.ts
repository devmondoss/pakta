/**
 * Exported as a test double: an in-memory gate with the real contract's rules,
 * for tests and offline demos. Never wire it into a production path.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { GateError, type GateClient, type IssuerSignatureArg, type OnChainPayable, type SubmittedTx } from "./chain.js";
import type { PreparedRegistration } from "./registration.js";

/**
 * An in-memory PayableGate with the contract's semantics, for testing the
 * adapter without a network.
 *
 * It is deliberately not more permissive than the real one: it verifies the
 * issuer's Ed25519 signature over the registration digest, refuses duplicate
 * registrations, refuses to settle anything that is not READY, and counts every
 * payment so a test can assert that money moved exactly once.
 */
export class FakeGate implements GateClient {
  readonly payables = new Map<string, OnChainPayable>();
  readonly payments: { payableIdHash: string; recipient: string; amount: bigint }[] = [];
  readonly calls: string[] = [];
  #ledger = 1000;
  #txCounter = 0;
  committed = 0n;
  balance: bigint;

  /** Lets a test inject a failure into the next call of a given method. */
  failNext: Partial<Record<"registerPayable" | "settle", GateError>> = {};
  /** Lets a test simulate "the write landed, but the response was lost". */
  loseResponseOf: Partial<Record<"registerPayable" | "settle", boolean>> = {};

  constructor(
    readonly trustedIssuerHex: string,
    balance = 1_000_000n * 10_000_000n,
  ) {
    this.balance = balance;
  }

  async getPayable(payableIdHash: string): Promise<OnChainPayable | undefined> {
    this.calls.push("getPayable");
    const p = this.payables.get(payableIdHash);
    return p ? { ...p } : undefined;
  }

  async getCommitted(): Promise<bigint> {
    return this.committed;
  }

  async getAvailable(): Promise<bigint> {
    return this.balance - this.committed;
  }

  async registerPayable(prepared: PreparedRegistration, signatures: IssuerSignatureArg[]): Promise<SubmittedTx> {
    this.calls.push("registerPayable");
    this.#maybeFail("registerPayable");
    if (this.payables.has(prepared.payableIdHash)) {
      throw new GateError("register_payable was refused by the gate: PayableAlreadyExists", "PayableAlreadyExists");
    }
    const sig = signatures[0];
    if (!sig || sig.issuerPublicKeyHex !== this.trustedIssuerHex) {
      throw new GateError("register_payable was refused by the gate: UnknownIssuer", "UnknownIssuer");
    }
    if (!this.#verify(sig, prepared.registrationDigest)) {
      throw new GateError("register_payable was refused by the gate: a signature did not verify", "InvalidSignature");
    }
    this.payables.set(prepared.payableIdHash, {
      proofHash: prepared.proofHash,
      recipient: prepared.recipient,
      amount: prepared.amountUnits,
      policyHash: prepared.policyHash,
      expiry: prepared.expiry,
      status: "READY",
    });
    this.committed += prepared.amountUnits;
    return this.#tx("registerPayable");
  }

  async settle(payableIdHash: string): Promise<SubmittedTx> {
    this.calls.push("settle");
    this.#maybeFail("settle");
    const p = this.payables.get(payableIdHash);
    if (!p) throw new GateError("settle was refused by the gate: PayableNotFound", "PayableNotFound");
    if (p.status !== "READY") throw new GateError("settle was refused by the gate: NotReady", "NotReady");
    p.status = "SETTLED";
    this.committed -= p.amount;
    this.balance -= p.amount;
    this.payments.push({ payableIdHash, recipient: p.recipient, amount: p.amount });
    return this.#tx("settle");
  }

  async revokePayable(payableIdHash: string): Promise<SubmittedTx> {
    const p = this.payables.get(payableIdHash);
    if (!p || p.status !== "READY") throw new GateError("revoke_payable was refused by the gate: NotReady", "NotReady");
    p.status = "REVOKED";
    this.committed -= p.amount;
    return this.#tx("revokePayable");
  }

  async expireBatch(payableIdHashes: string[]): Promise<SubmittedTx> {
    const now = Math.floor(Date.now() / 1000);
    for (const id of payableIdHashes) {
      const p = this.payables.get(id);
      if (p && p.status === "READY" && now > p.expiry) {
        p.status = "EXPIRED";
        this.committed -= p.amount;
      }
    }
    return this.#tx("expireBatch");
  }

  #maybeFail(method: "registerPayable" | "settle") {
    const failure = this.failNext[method];
    if (failure) {
      delete this.failNext[method];
      throw failure;
    }
  }

  #tx(method: "registerPayable" | "settle" | "revokePayable" | "expireBatch"): SubmittedTx {
    this.#ledger += 1;
    this.#txCounter += 1;
    const tx = {
      txHash: createHash("sha256").update(`tx-${this.#txCounter}`).digest("hex"),
      ledger: this.#ledger,
    };
    if ((method === "registerPayable" || method === "settle") && this.loseResponseOf[method]) {
      delete this.loseResponseOf[method];
      throw new Error("timeout waiting for the transaction — it may or may not have landed");
    }
    return tx;
  }

  #verify(sig: IssuerSignatureArg, digestHex: string): boolean {
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(sig.issuerPublicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(digestHex, "hex"), publicKey, Buffer.from(sig.signature));
  }
}
