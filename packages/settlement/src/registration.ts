import { createHash } from "node:crypto";
import { ProofOfPayable } from "@pakta/canonical-model";
import { isoToUnixSeconds, proofHash, registrationDigestHex, type JsonValue } from "@pakta/proof-hash";
import { decimalToUnits, decodeAccountId } from "@pakta/stellar-sdk-wrapper";
import type { Deployment } from "./deployment.js";

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

/**
 * Exactly the arguments `register_payable` takes, derived from a v1.1 proof,
 * plus the digest the issuer must sign.
 *
 * This is the seam between Dev 2's world (decimal strings, ISO timestamps,
 * business ids) and the contract's (i128 units, u64 seconds, 32-byte hashes).
 * Every conversion happens here and nowhere else, so there is one place where
 * a malformed proof is refused.
 */
export type PreparedRegistration = {
  /** Business id, e.g. "PAY-INV-001". */
  payableId: string;
  /** SHA-256 of `payableId` — the contract's storage key and anti-replay marker. */
  payableIdHash: string;
  proofHash: string;
  recipient: string;
  amountUnits: bigint;
  /** SHA-256 of `policy_version`. */
  policyHash: string;
  expiry: number;
  /** What the issuer signs, and what the contract recomputes. */
  registrationDigest: string;
};

const sha256Hex = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export function prepareRegistration(input: unknown, deployment: Deployment): PreparedRegistration {
  const parsed = ProofOfPayable.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new RegistrationError(`not a valid v1.1 ProofOfPayable — ${problems}`);
  }
  const proof = parsed.data;

  // The schema checks the shape of the wallet; this checks the StrKey checksum,
  // which is what actually separates a real account from a plausible typo.
  try {
    decodeAccountId(proof.vendor_wallet);
  } catch (error) {
    throw new RegistrationError(`vendor_wallet is not a valid Stellar account: ${(error as Error).message}`);
  }

  // A proof names the asset it authorizes. Settling it through a gate wired to
  // a different asset would pay a different currency than the one approved.
  if (proof.asset !== deployment.assetCode) {
    throw new RegistrationError(
      `proof authorizes ${proof.asset} but this deployment settles ${deployment.assetCode}`,
    );
  }

  const amountUnits = decimalToUnits(proof.amount);
  const expiry = isoToUnixSeconds(proof.expires_at);
  const hash = proofHash(proof as unknown as Record<string, JsonValue>);

  return {
    payableId: proof.payable_id,
    payableIdHash: sha256Hex(proof.payable_id),
    proofHash: hash,
    recipient: proof.vendor_wallet,
    amountUnits,
    policyHash: sha256Hex(proof.policy_version),
    expiry,
    registrationDigest: registrationDigestHex({
      networkPassphrase: deployment.networkPassphrase,
      contractId: deployment.contractId,
      payableId: proof.payable_id,
      proofHash: hash,
      recipient: proof.vendor_wallet,
      assetContractId: deployment.assetContractId,
      amountUnits,
      policyVersion: proof.policy_version,
      expiryUnixSeconds: expiry,
    }),
  };
}
