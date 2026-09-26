import { Settlement, type ProofOfPayable } from "@pakta/canonical-model";
import { beforeEach, describe, expect, it } from "vitest";
import {
  GateError,
  Issuer,
  MemorySettlementStore,
  SettlementAdapter,
  SettlementRefused,
  loadDeployment,
  type SettlementContext,
} from "../src/index.js";
import { FakeGate } from "../src/fakeGate.js";

const deployment = loadDeployment("testnet");
const NOW = new Date("2026-09-25T12:00:00Z");
const issuer = new Issuer(new Uint8Array(32).fill(7));

const PROOF: ProofOfPayable = {
  payable_id: "PAY-INV-001",
  invoice_hash: "a".repeat(64),
  po_hash: "b".repeat(64),
  receipt_hash: "c".repeat(64),
  vendor_id: "VEN-001",
  vendor_wallet: "GAGCMMI5YDAYYVZDMUOZZXEVS3OSSNKTATYHAFMFCCEISRYZH5F4JZI2",
  wallet_attestation_version: 1,
  amount: "5000.00",
  asset: "USDC",
  policy_version: "FIN-4.2",
  approvals_hash: "d".repeat(64),
  cost_center: "UNSPECIFIED",
  expires_at: "2026-09-27T12:00:00Z",
  status: "READY",
};

const CONTEXT: SettlementContext = { invoiceId: "INV-001", poId: "PO-72881", fingerprint: "VEN-001|5000.00" };

let gate: FakeGate;
let store: MemorySettlementStore;
let adapter: SettlementAdapter;

beforeEach(() => {
  gate = new FakeGate(issuer.publicKeyHex);
  store = new MemorySettlementStore();
  adapter = new SettlementAdapter({ gate, store, deployment, now: () => NOW });
});

function signed(proof: ProofOfPayable = PROOF) {
  return issuer.sign(proof, deployment).signed;
}

describe("a fresh proof", () => {
  it("is registered, then settled, for exactly the proof's amount to the proof's recipient", async () => {
    const outcome = await adapter.settle(signed(), CONTEXT);

    expect(outcome.status).toBe("SETTLED");
    expect(gate.calls.filter((c) => c === "registerPayable")).toHaveLength(1);
    expect(gate.payments).toEqual([
      {
        payableIdHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        recipient: PROOF.vendor_wallet,
        amount: 50_000_000_000n,
      },
    ]);
  });

  it("returns a v1.1 Settlement Dev 2 can read back, carrying proof_hash and the gate id", async () => {
    const outcome = await adapter.settle(signed(), CONTEXT);
    if (outcome.status !== "SETTLED") throw new Error("expected SETTLED");

    expect(Settlement.safeParse(outcome.settlement).success).toBe(true);
    expect(outcome.settlement.contract_id).toBe(deployment.contractId);
    expect(outcome.settlement.proof_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.settlement.erp_posting_status).toBe("PENDING");
  });

  it("records the settlement, and tells the kernel this invoice is paid", async () => {
    await adapter.settle(signed(), CONTEXT);

    expect((await store.getSettlement("PAY-INV-001"))?.amount).toBe("5000.00");
    expect((await store.getProof("PAY-INV-001"))?.status).toBe("SETTLED");
    // The kernel's PAYMENT_ALREADY_SETTLED rule reads this.
    expect(store.settledFingerprints.has("VEN-001|5000.00")).toBe(true);
  });
});

describe("idempotency: every retry converges on one payment", () => {
  it("a second call after success pays nothing and reports ALREADY_SETTLED", async () => {
    const proof = signed();
    await adapter.settle(proof, CONTEXT);
    const again = await adapter.settle(proof, CONTEXT);

    expect(again.status).toBe("ALREADY_SETTLED");
    expect(gate.payments).toHaveLength(1);
    expect(gate.calls.filter((c) => c === "settle")).toHaveLength(1);
  });

  it("a crash after registering resumes by settling only — no second registration", async () => {
    const proof = signed();
    gate.failNext.settle = new Error("process killed") as GateError;
    await expect(adapter.settle(proof, CONTEXT)).rejects.toThrow("process killed");
    expect(gate.payments).toHaveLength(0);

    const retried = await adapter.settle(proof, CONTEXT);
    expect(retried.status).toBe("SETTLED");
    expect(gate.calls.filter((c) => c === "registerPayable")).toHaveLength(1);
    expect(gate.payments).toHaveLength(1);
  });

  it("a settle whose response was lost is recognized as paid on retry", async () => {
    const proof = signed();
    gate.loseResponseOf.settle = true;
    await expect(adapter.settle(proof, CONTEXT)).rejects.toThrow(/timeout/);
    // The payment did land — the network just never told us.
    expect(gate.payments).toHaveLength(1);

    const retried = await adapter.settle(proof, CONTEXT);
    expect(retried.status).toBe("ALREADY_SETTLED");
    expect(gate.payments).toHaveLength(1);
  });

  it("losing a race to register is not an error — it carries on and settles", async () => {
    const proof = signed();
    // Another process registers it first...
    await gate.registerPayable(issuer.sign(PROOF, deployment).prepared, [
      { issuerPublicKeyHex: issuer.publicKeyHex, signature: issuer.signDigest(issuer.sign(PROOF, deployment).prepared.registrationDigest) },
    ]);
    // ...but our read happened just before.
    const read = gate.getPayable.bind(gate);
    let first = true;
    gate.getPayable = async (id) => (first ? ((first = false), undefined) : read(id));

    const outcome = await adapter.settle(proof, CONTEXT);
    expect(outcome.status).toBe("SETTLED");
    expect(gate.payments).toHaveLength(1);
  });

  it("losing a race to settle is recognized as ALREADY_SETTLED, not a failure", async () => {
    const proof = signed();
    const prepared = issuer.sign(PROOF, deployment).prepared;
    await gate.registerPayable(prepared, [
      { issuerPublicKeyHex: issuer.publicKeyHex, signature: issuer.signDigest(prepared.registrationDigest) },
    ]);
    // The other process settles between our read and our settle.
    const settleForReal = gate.settle.bind(gate);
    gate.settle = async (id) => {
      await settleForReal(id);
      return settleForReal(id); // our own attempt: now NotReady
    };

    const outcome = await adapter.settle(proof, CONTEXT);
    expect(outcome.status).toBe("ALREADY_SETTLED");
    expect(gate.payments).toHaveLength(1);
  });
});

describe("what the adapter refuses before spending a transaction", () => {
  it("a proof about to expire — §14.3's revalidation at execution time", async () => {
    const nearlyExpired = { ...PROOF, expires_at: "2026-09-25T12:01:00Z" };
    await expect(adapter.settle(signed(nearlyExpired), CONTEXT)).rejects.toMatchObject({ reason: "STALE_PROOF" });
    expect(gate.calls).not.toContain("registerPayable");
  });

  it("an envelope altered after signing", async () => {
    const tampered = { ...signed(), vendor_wallet: "GBULRZJR3HMP4DRBMT5OFCO6RIX7QYUC5PVHBCZXXLTBLRTYKZQYIVIN" };
    await expect(adapter.settle(tampered, CONTEXT)).rejects.toMatchObject({ reason: "INVALID_PROOF" });
    expect(gate.calls).toHaveLength(0);
  });

  it("a proof signed for a different gate", async () => {
    const otherGate = { ...deployment, contractId: "CB5GBGSEAHW3QWVZL25BQU672MHF7UBRAGD4PA3T5V57RQO7LMKJHA2N" };
    const foreign = issuer.sign(PROOF, otherGate).signed;
    await expect(adapter.settle(foreign, CONTEXT)).rejects.toMatchObject({ reason: "INVALID_PROOF" });
  });

  it("a payable already revoked or expired on-chain", async () => {
    const proof = signed();
    await adapter.settle(proof, { ...CONTEXT }).catch(() => undefined);
    // Reset and revoke instead.
    gate = new FakeGate(issuer.publicKeyHex);
    adapter = new SettlementAdapter({ gate, store: new MemorySettlementStore(), deployment, now: () => NOW });
    const prepared = issuer.sign(PROOF, deployment).prepared;
    await gate.registerPayable(prepared, [
      { issuerPublicKeyHex: issuer.publicKeyHex, signature: issuer.signDigest(prepared.registrationDigest) },
    ]);
    await gate.revokePayable(prepared.payableIdHash);

    await expect(adapter.settle(proof, CONTEXT)).rejects.toMatchObject({ reason: "ALREADY_CLOSED" });
    expect(gate.payments).toHaveLength(0);
  });

  it("a registration on-chain that does not match the proof", async () => {
    // Same payable id, different amount — only possible with another issuer
    // signature, but the adapter checks rather than assumes.
    const prepared = issuer.sign({ ...PROOF, amount: "4999.00" }, deployment).prepared;
    await gate.registerPayable(prepared, [
      { issuerPublicKeyHex: issuer.publicKeyHex, signature: issuer.signDigest(prepared.registrationDigest) },
    ]);

    await expect(adapter.settle(signed(), CONTEXT)).rejects.toMatchObject({ reason: "ONCHAIN_MISMATCH" });
    expect(gate.payments).toHaveLength(0);
  });

  it("a gate refusal surfaces the contract's own error name", async () => {
    gate.failNext.settle = new GateError("settle was refused by the gate: WindowCapExceeded", "WindowCapExceeded");
    const error = await adapter.settle(signed(), CONTEXT).catch((e) => e);
    expect(error).toBeInstanceOf(SettlementRefused);
    expect(error.reason).toBe("GATE_REFUSED");
    expect(error.message).toMatch(/WindowCapExceeded/);
  });
});

describe("GateError.from", () => {
  it("turns a contract error number back into its name", () => {
    expect(GateError.from("settle", "HostError: Error(Contract, #6)").code).toBe("NotReady");
    expect(GateError.from("withdraw", "... Error(Contract, #20) ...").code).toBe("WithdrawExceedsAvailable");
    expect(GateError.from("register_payable", "Error(Contract, #22)").code).toBe("ProofWindowTooLong");
  });

  it("recognizes a failed signature, which traps instead of returning a code", () => {
    expect(GateError.from("register_payable", "HostError: Error(Crypto, InvalidInput)").code).toBe("InvalidSignature");
  });

  it("keeps anything else as a plain failure", () => {
    expect(GateError.from("settle", "network unreachable").code).toBeUndefined();
  });
});

describe("reconciling a settlement the backend never recorded", () => {
  it("rebuilds it from the chain event when the event arrived before the proof was known", async () => {
    const proof = signed();
    const { prepared } = issuer.sign(PROOF, deployment);

    // Paid on-chain by an earlier run whose local state is gone...
    await gate.registerPayable(prepared, [
      { issuerPublicKeyHex: issuer.publicKeyHex, signature: issuer.signDigest(prepared.registrationDigest) },
    ]);
    const tx = await gate.settle(prepared.payableIdHash);
    // ...and the indexer stored the event, but could not attribute it.
    await store.recordChainEvent({
      id: "evt-1",
      type: "settlement_executed",
      ledger: tx.ledger,
      txHash: tx.txHash,
      payableIdHash: prepared.payableIdHash,
      payload: {},
    });
    expect(await store.getSettlement("PAY-INV-001")).toBeUndefined();

    const outcome = await adapter.settle(proof, CONTEXT);

    expect(outcome.status).toBe("ALREADY_SETTLED");
    expect(await store.getSettlement("PAY-INV-001")).toMatchObject({ txHash: tx.txHash, ledger: tx.ledger });
    if (outcome.status === "ALREADY_SETTLED") expect(outcome.settlement?.settlement.tx_hash).toBe(tx.txHash);
    expect(store.settledFingerprints.has("VEN-001|5000.00")).toBe(true);
    expect(gate.payments).toHaveLength(1);
  });
});
