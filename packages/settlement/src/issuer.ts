import { createPrivateKey, createPublicKey, sign as ed25519Sign, verify as ed25519Verify } from "node:crypto";
import { SignedProofOfPayable, type ProofOfPayable } from "@pakta/canonical-model";
import { revocationDigestHex } from "@pakta/proof-hash";
import { decodeAccountId, decodeSecretSeed, encodeAccountId } from "@pakta/stellar-sdk-wrapper";
import type { Deployment } from "./deployment.js";
import { prepareRegistration, type PreparedRegistration } from "./registration.js";

/**
 * The proof issuer: the one key the settlement gate trusts to say "this
 * obligation is real and ready".
 *
 * It holds an Ed25519 seed and nothing else. It is not a Soroban account and
 * never submits a transaction — it only signs digests. That separation is the
 * point: whoever submits a transaction cannot change what the issuer signed,
 * and the issuer cannot move money on its own.
 *
 * The seed must come from the environment or a secrets store, never from a
 * file in the repository, and must never be logged.
 */
export class Issuer {
  readonly #privateKey: ReturnType<typeof createPrivateKey>;
  readonly publicKeyHex: string;
  readonly accountId: string;

  /** From the 32 raw seed bytes. Prefer `fromSecret` / `fromEnv` outside tests. */
  constructor(seed: Uint8Array) {
    if (seed.length !== 32) throw new Error("an Ed25519 seed is exactly 32 bytes");
    // Fixed DER header for an Ed25519 PKCS8 private key: wraps the raw seed
    // without pulling in a signing library.
    const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(seed)]);
    this.#privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });

    const spki = createPublicKey(this.#privateKey).export({ format: "der", type: "spki" });
    const publicKey = new Uint8Array(spki.subarray(spki.length - 32));
    this.publicKeyHex = Buffer.from(publicKey).toString("hex");
    this.accountId = encodeAccountId(publicKey);
  }

  /** From a Stellar `S...` secret seed. */
  static fromSecret(secretSeed: string): Issuer {
    return new Issuer(decodeSecretSeed(secretSeed));
  }

  static fromEnv(variable = "PAKTA_ISSUER_SECRET"): Issuer {
    const secret = process.env[variable];
    if (!secret) throw new Error(`${variable} is not set — the issuer cannot sign without its seed`);
    return Issuer.fromSecret(secret);
  }

  /** Raw 64-byte Ed25519 signature over a 32-byte digest given as hex. */
  signDigest(digestHex: string): Uint8Array {
    return new Uint8Array(ed25519Sign(null, Buffer.from(digestHex, "hex"), this.#privateKey));
  }

  /**
   * Turns a v1.1 proof into the signed envelope the settlement path consumes.
   * The signature covers the registration digest, which binds the proof to this
   * deployment's network, contract and asset.
   */
  sign(proof: ProofOfPayable, deployment: Deployment): { signed: SignedProofOfPayable; prepared: PreparedRegistration } {
    const prepared = prepareRegistration(proof, deployment);
    const signature = this.signDigest(prepared.registrationDigest);

    const signed = SignedProofOfPayable.parse({
      ...proof,
      proof_hash: prepared.proofHash,
      issuer_public_key: this.accountId,
      issuer_signature: Buffer.from(signature).toString("base64"),
      network_passphrase: deployment.networkPassphrase,
      contract_id: deployment.contractId,
    });
    return { signed, prepared };
  }

  /** Signs the cancellation of a payable this issuer already authorized. */
  signRevocation(payableId: string, proofHashHex: string, deployment: Deployment): Uint8Array {
    return this.signDigest(
      revocationDigestHex({
        networkPassphrase: deployment.networkPassphrase,
        contractId: deployment.contractId,
        payableId,
        proofHash: proofHashHex,
      }),
    );
  }
}

/**
 * Checks a signed envelope the way the contract will, before a transaction is
 * spent on it: the proof_hash must match the payload, and the signature must
 * verify against the registration digest for *this* deployment.
 */
export function verifySignedProof(signed: SignedProofOfPayable, deployment: Deployment): PreparedRegistration {
  if (signed.contract_id !== deployment.contractId) {
    throw new Error(`proof was signed for gate ${signed.contract_id}, not ${deployment.contractId}`);
  }
  if (signed.network_passphrase !== deployment.networkPassphrase) {
    throw new Error("proof was signed for a different network");
  }

  const {
    proof_hash,
    issuer_public_key,
    issuer_signature,
    network_passphrase: _network,
    contract_id: _contract,
    ...payload
  } = signed;

  const prepared = prepareRegistration(payload, deployment);
  if (prepared.proofHash !== proof_hash) {
    throw new Error("proof_hash does not match the payload — the proof was altered after signing");
  }

  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(decodeAccountId(issuer_public_key))]),
    format: "der",
    type: "spki",
  });
  const valid = ed25519Verify(
    null,
    Buffer.from(prepared.registrationDigest, "hex"),
    publicKey,
    Buffer.from(issuer_signature, "base64"),
  );
  if (!valid) throw new Error("issuer signature does not verify against the registration digest");

  return prepared;
}
