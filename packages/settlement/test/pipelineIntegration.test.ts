import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ProofOfPayable, SignedProofOfPayable, type CanonicalPayable } from "@pakta/canonical-model";
import { ingestWorkbook } from "@pakta/ingestion";
import { buildProofOfPayable, ProofBuilderError } from "@pakta/proof-builder";
import { evaluateBatch, loadPolicyFromYaml, type KernelResult } from "@pakta/rules-kernel";
import { beforeAll, describe, expect, it } from "vitest";
import { Issuer, loadDeployment, prepareRegistration, verifySignedProof } from "../src/index.js";

/**
 * Integration across the Dev 2 / Dev 1 boundary, with nothing mocked:
 *
 *   demo-workbook.xlsx -> ingestWorkbook -> evaluateBatch (kernel)
 *     -> buildProofOfPayable (Dev 2) -> prepareRegistration (Dev 1 adapter)
 *     -> issuer signature -> verifySignedProof
 *
 * Before v1.1 every proof Dev 2 produced was rejected at the second-to-last
 * arrow, because `expires_at` carried milliseconds. This test is what keeps
 * the two halves from drifting apart again.
 *
 * It also pins the exact register_payable arguments in
 * fixtures/integration/inv-001-registration.json. The contract's Rust test
 * (`test/integration.rs`) reads that same file and registers + settles it
 * against the real contract code, so a change in either half fails on both
 * sides. Regenerate deliberately with UPDATE_INTEGRATION_FIXTURE=1.
 */

const repo = path.resolve(import.meta.dirname, "../../..");
const workbookDir = path.join(repo, "fixtures/demo-workbook");
const fixturePath = path.join(repo, "fixtures/integration/inv-001-registration.json");

/** Fixed, so the pinned fixture is reproducible. */
const NOW = new Date("2026-09-23T09:00:00Z");

/**
 * A throwaway test key — deliberately NOT the real issuer. The real seed only
 * ever lives in the environment.
 */
const TEST_ISSUER = new Issuer(new Uint8Array(32).fill(7));

const deployment = loadDeployment("testnet");

let payables: CanonicalPayable[];
let results: KernelResult[];

beforeAll(async () => {
  const policy = loadPolicyFromYaml(readFileSync(path.join(workbookDir, "policy.yaml"), "utf-8"));
  ({ payables } = await ingestWorkbook(readFileSync(path.join(workbookDir, "demo-workbook.xlsx")), policy));
  results = evaluateBatch(payables, {
    policy,
    now: NOW,
    knownInvoiceFingerprints: new Set(["VEN-002|3500.00"]),
    settledInvoiceFingerprints: new Set(),
  });
});

function pipelineFor(invoiceId: string) {
  const payable = payables.find((p) => p.invoice.invoiceId === invoiceId)!;
  const result = results.find((r) => r.payableId === payable.payableId)!;
  return { payable, result };
}

function inv001Proof() {
  const { payable, result } = pipelineFor("INV-001");
  return buildProofOfPayable(payable, result, NOW);
}

describe("Dev 2's proof is accepted by Dev 1's settlement path", () => {
  it("the kernel's READY payable produces a schema-valid v1.1 proof", () => {
    const proof = inv001Proof();
    expect(ProofOfPayable.safeParse(proof).success).toBe(true);
  });

  it("the adapter turns it into exactly the arguments register_payable expects", () => {
    const prepared = prepareRegistration(inv001Proof(), deployment);

    expect(prepared.payableId).toBe("PAY-INV-001");
    expect(prepared.recipient).toBe("GAGCMMI5YDAYYVZDMUOZZXEVS3OSSNKTATYHAFMFCCEISRYZH5F4JZI2");
    expect(prepared.amountUnits).toBe(50_000_000_000n); // 5000.00 USDC at 7 decimals
    expect(prepared.expiry).toBe(NOW.getTime() / 1000 + 48 * 3600);
    for (const field of ["payableIdHash", "proofHash", "policyHash", "registrationDigest"] as const) {
      expect(prepared[field], field).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("the issuer signs it and the signed envelope verifies the way the contract will", () => {
    const { signed, prepared } = TEST_ISSUER.sign(inv001Proof(), deployment);

    expect(SignedProofOfPayable.safeParse(signed).success).toBe(true);
    expect(signed.contract_id).toBe(deployment.contractId);
    expect(verifySignedProof(signed, deployment)).toEqual(prepared);
  });

  it("a proof altered after signing is caught before a transaction is spent", () => {
    const { signed } = TEST_ISSUER.sign(inv001Proof(), deployment);

    // Recipient swapped in the envelope — the classic attack.
    expect(() =>
      verifySignedProof(
        { ...signed, vendor_wallet: "GBULRZJR3HMP4DRBMT5OFCO6RIX7QYUC5PVHBCZXXLTBLRTYKZQYIVIN" },
        deployment,
      ),
    ).toThrow(/altered after signing/);

    // proof_hash recomputed to match the swap — now the signature fails instead.
    const swapped = { ...signed, vendor_wallet: "GBULRZJR3HMP4DRBMT5OFCO6RIX7QYUC5PVHBCZXXLTBLRTYKZQYIVIN" };
    const { proof_hash: _p, issuer_public_key: _k, issuer_signature: _s, network_passphrase: _n, contract_id: _c, ...payload } =
      swapped;
    const rehashed = { ...swapped, proof_hash: prepareRegistration(payload, deployment).proofHash };
    expect(() => verifySignedProof(rehashed, deployment)).toThrow(/signature does not verify/);
  });

  it("a proof signed for another gate is refused rather than submitted", () => {
    const { signed } = TEST_ISSUER.sign(inv001Proof(), deployment);
    const otherGate = { ...deployment, contractId: "CB5GBGSEAHW3QWVZL25BQU672MHF7UBRAGD4PA3T5V57RQO7LMKJHA2N" };
    expect(() => verifySignedProof(signed, otherGate)).toThrow(/signed for gate/);
  });

  it("none of the four BLOCKED payables can even reach the adapter", () => {
    for (const invoiceId of ["INV-002", "INV-003", "INV-004", "INV-005"]) {
      const { payable, result } = pipelineFor(invoiceId);
      expect(result.status, invoiceId).toBe("BLOCKED");
      expect(() => buildProofOfPayable(payable, result, NOW), invoiceId).toThrow(ProofBuilderError);
    }
  });
});

describe("the pinned registration fixture shared with the contract's Rust test", () => {
  it("matches what the real pipeline produces today", () => {
    const proof = inv001Proof();
    const prepared = prepareRegistration(proof, deployment);
    const current = {
      _comment:
        "Generated by packages/settlement/test/pipelineIntegration.test.ts from the real workbook -> kernel -> proof-builder -> adapter pipeline. Consumed by contracts/payable-contract/src/test/integration.rs. Regenerate with UPDATE_INTEGRATION_FIXTURE=1 pnpm test.",
      generated_at: NOW.toISOString(),
      proof,
      registration: {
        payable_id: prepared.payableId,
        payable_id_hash: prepared.payableIdHash,
        proof_hash: prepared.proofHash,
        recipient: prepared.recipient,
        amount_units: prepared.amountUnits.toString(),
        policy_hash: prepared.policyHash,
        expiry: prepared.expiry,
      },
    };

    if (process.env.UPDATE_INTEGRATION_FIXTURE === "1" || !existsSync(fixturePath)) {
      mkdirSync(path.dirname(fixturePath), { recursive: true });
      writeFileSync(fixturePath, `${JSON.stringify(current, null, 2)}\n`);
    }

    const pinned = JSON.parse(readFileSync(fixturePath, "utf8"));
    expect(current).toEqual(pinned);
  });
});
