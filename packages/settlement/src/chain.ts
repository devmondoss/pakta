import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import type { Deployment } from "./deployment.js";
import type { PreparedRegistration } from "./registration.js";

/**
 * Everything the backend asks of the PayableGate, behind an interface.
 *
 * The adapter, the indexer and the agent depend on this, not on the SDK, so
 * their logic — idempotency, revalidation, what happens when a transaction
 * races another — is tested without a network, and `SorobanGateClient` is the
 * one place that speaks RPC.
 */
export type OnChainStatus = "READY" | "SETTLED" | "EXPIRED" | "REVOKED";

export type OnChainPayable = {
  proofHash: string;
  recipient: string;
  amount: bigint;
  policyHash: string;
  expiry: number;
  status: OnChainStatus;
};

export type IssuerSignatureArg = { issuerPublicKeyHex: string; signature: Uint8Array };

export type SubmittedTx = { txHash: string; ledger: number };

export interface GateClient {
  getPayable(payableIdHash: string): Promise<OnChainPayable | undefined>;
  getCommitted(): Promise<bigint>;
  getAvailable(): Promise<bigint>;
  registerPayable(prepared: PreparedRegistration, signatures: IssuerSignatureArg[]): Promise<SubmittedTx>;
  settle(payableIdHash: string): Promise<SubmittedTx>;
  revokePayable(payableIdHash: string, reasonCode: string, signatures: IssuerSignatureArg[]): Promise<SubmittedTx>;
  expireBatch(payableIdHashes: string[]): Promise<SubmittedTx>;
}

/**
 * The gate's error enum, as `types.rs` declares it. A contract failure arrives
 * as "Error(Contract, #N)"; this turns N back into a name a human can act on.
 */
export const GATE_ERRORS: Record<number, string> = {
  1: "AlreadyInitialized",
  2: "NotInitialized",
  3: "Paused",
  4: "PayableAlreadyExists",
  5: "PayableNotFound",
  6: "NotReady",
  7: "ProofExpired",
  8: "ProofNotExpired",
  9: "AmountNotPositive",
  10: "AmountAboveCap",
  11: "WindowCapExceeded",
  12: "ThresholdNotMet",
  13: "UnknownIssuer",
  14: "DuplicateIssuer",
  15: "InvalidThreshold",
  16: "InvalidExpiry",
  17: "InvalidLimits",
  18: "UnknownPhase",
  19: "InsufficientAvailable",
  20: "WithdrawExceedsAvailable",
  21: "NotAVault",
  22: "ProofWindowTooLong",
};

export class GateError extends Error {
  constructor(
    message: string,
    /** The contract's error name when the failure was a contract error, e.g. "NotReady". */
    readonly code?: string,
  ) {
    super(message);
    this.name = "GateError";
  }

  /** Wraps a raw RPC/simulation failure, extracting the contract error if there is one. */
  static from(operation: string, detail: string): GateError {
    const contract = /Error\(Contract, #(\d+)\)/.exec(detail);
    if (contract) {
      const code = GATE_ERRORS[Number(contract[1])] ?? `Contract#${contract[1]}`;
      return new GateError(`${operation} was refused by the gate: ${code}`, code);
    }
    if (/Error\(Crypto, InvalidInput\)/.test(detail)) {
      // ed25519_verify traps instead of returning an error code.
      return new GateError(`${operation} was refused by the gate: a signature did not verify`, "InvalidSignature");
    }
    return new GateError(`${operation} failed: ${detail.slice(0, 500)}`);
  }
}

const STATUS_BY_INDEX: OnChainStatus[] = ["READY", "SETTLED", "EXPIRED", "REVOKED"];

const bytes32 = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, "hex"));

/**
 * `Vec<IssuerSignature>` as the contract's XDR expects it: each struct is a map
 * with symbol keys in sorted order ("issuer" < "signature").
 */
function signaturesArg(signatures: IssuerSignatureArg[]): xdr.ScVal {
  return xdr.ScVal.scvVec(
    signatures.map((sig) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("issuer"), val: bytes32(sig.issuerPublicKeyHex) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("signature"), val: xdr.ScVal.scvBytes(Buffer.from(sig.signature)) }),
      ]),
    ),
  );
}

export type SorobanGateOptions = {
  deployment: Deployment;
  /**
   * Signs and pays for every transaction the backend submits. It must be the
   * gate's configured executor, because `settle` requires that account's
   * authorization. Its seed comes from the environment and never from a file.
   */
  executor: Keypair;
  /** Seconds to wait for a submitted transaction to land. */
  confirmTimeoutSeconds?: number;
};

export class SorobanGateClient implements GateClient {
  readonly #server: rpc.Server;
  readonly #contract: Contract;
  readonly #deployment: Deployment;
  readonly #executor: Keypair;
  readonly #confirmTimeoutSeconds: number;

  constructor(options: SorobanGateOptions) {
    this.#deployment = options.deployment;
    this.#executor = options.executor;
    this.#server = new rpc.Server(options.deployment.rpcUrl);
    this.#contract = new Contract(options.deployment.contractId);
    this.#confirmTimeoutSeconds = options.confirmTimeoutSeconds ?? 60;
  }

  static fromEnv(deployment: Deployment, variable = "PAKTA_EXECUTOR_SECRET"): SorobanGateClient {
    const secret = process.env[variable];
    if (!secret) throw new Error(`${variable} is not set — the backend cannot submit transactions without it`);
    return new SorobanGateClient({ deployment, executor: Keypair.fromSecret(secret) });
  }

  get executorAddress(): string {
    return this.#executor.publicKey();
  }

  async getPayable(payableIdHash: string): Promise<OnChainPayable | undefined> {
    const value = await this.#read("get_payable", [bytes32(payableIdHash)]);
    if (value === undefined || value === null) return undefined;
    const raw = value as {
      proof_hash: Buffer;
      recipient: string;
      amount: bigint;
      policy_hash: Buffer;
      expiry: bigint;
      status: number;
    };
    return {
      proofHash: Buffer.from(raw.proof_hash).toString("hex"),
      recipient: raw.recipient,
      amount: BigInt(raw.amount),
      policyHash: Buffer.from(raw.policy_hash).toString("hex"),
      expiry: Number(raw.expiry),
      status: STATUS_BY_INDEX[Number(raw.status)] ?? "READY",
    };
  }

  async getCommitted(): Promise<bigint> {
    return BigInt((await this.#read("get_committed", [])) as bigint);
  }

  async getAvailable(): Promise<bigint> {
    return BigInt((await this.#read("get_available", [])) as bigint);
  }

  registerPayable(prepared: PreparedRegistration, signatures: IssuerSignatureArg[]): Promise<SubmittedTx> {
    return this.#submit("register_payable", [
      bytes32(prepared.payableIdHash),
      bytes32(prepared.proofHash),
      new Address(prepared.recipient).toScVal(),
      nativeToScVal(prepared.amountUnits, { type: "i128" }),
      bytes32(prepared.policyHash),
      nativeToScVal(BigInt(prepared.expiry), { type: "u64" }),
      signaturesArg(signatures),
    ]);
  }

  settle(payableIdHash: string): Promise<SubmittedTx> {
    return this.#submit("settle", [bytes32(payableIdHash)]);
  }

  revokePayable(payableIdHash: string, reasonCode: string, signatures: IssuerSignatureArg[]): Promise<SubmittedTx> {
    return this.#submit("revoke_payable", [
      bytes32(payableIdHash),
      nativeToScVal(reasonCode, { type: "string" }),
      signaturesArg(signatures),
    ]);
  }

  expireBatch(payableIdHashes: string[]): Promise<SubmittedTx> {
    return this.#submit("expire_batch", [xdr.ScVal.scvVec(payableIdHashes.map(bytes32))]);
  }

  /** Simulates a read-only call and decodes its return value. */
  async #read(method: string, args: xdr.ScVal[]): Promise<unknown> {
    const account = await this.#server.getAccount(this.#executor.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.#deployment.networkPassphrase,
    })
      .addOperation(this.#contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simulation = await this.#server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulation)) {
      throw GateError.from(method, simulation.error);
    }
    const retval = simulation.result?.retval;
    return retval ? scValToNative(retval) : undefined;
  }

  /**
   * Builds, simulates (which also attaches the authorization entries and
   * resource footprint), signs with the executor, submits, and waits for the
   * ledger to include it. A transaction the network accepted but then failed
   * is an error, not a success with a hash.
   */
  async #submit(method: string, args: xdr.ScVal[]): Promise<SubmittedTx> {
    const account = await this.#server.getAccount(this.#executor.publicKey());
    const built = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.#deployment.networkPassphrase,
    })
      .addOperation(this.#contract.call(method, ...args))
      .setTimeout(60)
      .build();

    let prepared;
    try {
      prepared = await this.#server.prepareTransaction(built);
    } catch (error) {
      throw GateError.from(method, error instanceof Error ? error.message : String(error));
    }
    prepared.sign(this.#executor);

    const sent = await this.#server.sendTransaction(prepared);
    if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
      throw GateError.from(method, `submission ${sent.status}: ${JSON.stringify(sent.errorResult ?? "")}`);
    }

    const final = await this.#server.pollTransaction(sent.hash, {
      attempts: this.#confirmTimeoutSeconds,
      sleepStrategy: () => 1000,
    });
    if (final.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
      throw GateError.from(method, `transaction ${sent.hash} ended as ${final.status}`);
    }
    return { txHash: sent.hash, ledger: final.ledger };
  }
}
