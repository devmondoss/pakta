import { createHash } from "node:crypto";
import { decodeAccountId, decodeContractId } from "@pakta/stellar-sdk-wrapper";

/**
 * The `registration_digest` of `Pakta_Dia0_Dev1.md` §2 — the message the proof
 * issuer actually signs, and the one the contract recalculates from its own
 * typed arguments before verifying that signature.
 *
 * Why this exists separately from `proof_hash`: a signature over `proof_hash`
 * alone proves that *some* proof was issued, but it does not bind the
 * arguments the contract receives. Nothing would stop the same signed proof
 * from being replayed against a different contract, a different network, or
 * with a substituted recipient supplied alongside it. This digest covers all
 * ten values, so a mutation of any one of them invalidates the signature.
 *
 * The encoding is fixed-width and positional — no JSON, no delimiters, no
 * length prefixes — because the contract has to reproduce it in Rust and any
 * ambiguity there is a settlement that silently fails or, worse, succeeds
 * against the wrong binding.
 *
 * ```text
 * domain             13  ASCII "PAKTA_REG_V1" + 0x00
 * network_id         32  SHA-256 of the network passphrase
 * contract_id        32  raw bytes of the PayableGate C... id
 * payable_id_hash    32  SHA-256 of the payable_id as UTF-8
 * proof_hash         32  the JCS proof hash, as bytes
 * recipient          32  raw bytes of the vendor G... account
 * asset_contract_id  32  raw bytes of the SAC C... id
 * amount             16  i128, big endian, in 10^-7 units
 * policy_hash        32  SHA-256 of policy_version as UTF-8
 * expiry              8  u64, big endian, Unix seconds
 *                   ---
 *                   261 bytes, then SHA-256 over the whole thing
 * ```
 */

export const DOMAIN_SEPARATOR = "PAKTA_REG_V1";
export const REGISTRATION_PREIMAGE_BYTES = 261;

export class RegistrationDigestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationDigestError";
  }
}

export type RegistrationInput = {
  /** Network passphrase, e.g. "Test SDF Network ; September 2015". */
  networkPassphrase: string;
  /** `C...` id of the PayableGate contract this proof is valid against. */
  contractId: string;
  /** The business identifier, e.g. "PAY-2026-9182". */
  payableId: string;
  /** 64 lowercase hex characters, from `proofHash()`. */
  proofHash: string;
  /** `G...` account of the vendor. */
  recipient: string;
  /** `C...` id of the asset's Stellar Asset Contract. */
  assetContractId: string;
  /** Amount in 10^-7 units, as produced by `decimalToUnits()`. */
  amountUnits: bigint;
  /** Policy identifier, e.g. "FIN-4.2". */
  policyVersion: string;
  /** Expiry as Unix seconds. */
  expiryUnixSeconds: number | bigint;
};

const HEX_64 = /^[0-9a-f]{64}$/;

function sha256Bytes(input: Uint8Array | string): Uint8Array {
  const hash = createHash("sha256");
  hash.update(typeof input === "string" ? Buffer.from(input, "utf8") : input);
  return new Uint8Array(hash.digest());
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RegistrationDigestError(`${field} must be a non-empty string`);
  }
  return value;
}

function hexToBytes(hex: string, field: string): Uint8Array {
  if (!HEX_64.test(hex)) {
    throw new RegistrationDigestError(
      `${field} must be 64 lowercase hex characters with no 0x prefix`,
    );
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Positive i128, big endian, 16 bytes. */
function i128BigEndian(value: bigint, field: string): Uint8Array {
  if (typeof value !== "bigint") {
    throw new RegistrationDigestError(`${field} must be a bigint, got ${typeof value}`);
  }
  if (value <= 0n) {
    throw new RegistrationDigestError(`${field} must be positive, got ${value}`);
  }
  if (value > 2n ** 127n - 1n) {
    throw new RegistrationDigestError(`${field} exceeds what an i128 can hold`);
  }

  const out = new Uint8Array(16);
  let remaining = value;
  for (let i = 15; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

/** u64, big endian, 8 bytes. */
function u64BigEndian(value: number | bigint, field: string): Uint8Array {
  const asBigInt = typeof value === "bigint" ? value : BigInt(value);
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new RegistrationDigestError(`${field} must be a safe integer`);
  }
  if (asBigInt < 0n || asBigInt > 2n ** 64n - 1n) {
    throw new RegistrationDigestError(`${field} is outside the u64 range`);
  }

  const out = new Uint8Array(8);
  let remaining = asBigInt;
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

/**
 * ISO-8601 UTC without fractional seconds (`YYYY-MM-DDTHH:mm:ssZ`) -> Unix
 * seconds. Deliberately narrow: an offset like `+00:00`, a fractional second
 * or a local timestamp would all be accepted by `Date.parse` while meaning
 * something the contract cannot reconstruct from 8 bytes unambiguously.
 */
export function isoToUnixSeconds(iso: string): number {
  requireNonEmptyString(iso, "expires_at");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(iso)) {
    throw new RegistrationDigestError(
      `"${iso}" must be ISO-8601 UTC with second precision, e.g. "2026-09-25T18:00:00Z"`,
    );
  }
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) {
    throw new RegistrationDigestError(`"${iso}" is not a valid date`);
  }
  return millis / 1000;
}

/** The 261-byte preimage. Exported so parity vectors can assert on the bytes, not only on the digest. */
export function registrationPreimage(input: RegistrationInput): Uint8Array {
  const domain = new Uint8Array(13);
  domain.set(new TextEncoder().encode(DOMAIN_SEPARATOR));
  // Byte 13 stays 0x00: it terminates the domain so that no future separator
  // sharing this prefix can produce the same leading bytes.

  const parts: Uint8Array[] = [
    domain,
    sha256Bytes(requireNonEmptyString(input.networkPassphrase, "networkPassphrase")),
    decodeContractId(requireNonEmptyString(input.contractId, "contractId")),
    sha256Bytes(requireNonEmptyString(input.payableId, "payableId")),
    hexToBytes(requireNonEmptyString(input.proofHash, "proofHash"), "proofHash"),
    decodeAccountId(requireNonEmptyString(input.recipient, "recipient")),
    decodeContractId(requireNonEmptyString(input.assetContractId, "assetContractId")),
    i128BigEndian(input.amountUnits, "amountUnits"),
    sha256Bytes(requireNonEmptyString(input.policyVersion, "policyVersion")),
    u64BigEndian(input.expiryUnixSeconds, "expiryUnixSeconds"),
  ];

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  if (total !== REGISTRATION_PREIMAGE_BYTES) {
    throw new RegistrationDigestError(
      `preimage is ${total} bytes, expected ${REGISTRATION_PREIMAGE_BYTES} — the encoding table and this code disagree`,
    );
  }

  const preimage = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    preimage.set(part, offset);
    offset += part.length;
  }
  return preimage;
}

/** The 32 bytes the issuer signs with Ed25519 and the contract recalculates. */
export function registrationDigest(input: RegistrationInput): Uint8Array {
  return sha256Bytes(registrationPreimage(input));
}

/** Same digest as 64 lowercase hex characters, for logs, fixtures and vectors. */
export function registrationDigestHex(input: RegistrationInput): string {
  return Buffer.from(registrationDigest(input)).toString("hex");
}
