import { createHash } from "node:crypto";

/**
 * JSON Canonicalization Scheme (RFC 8785) — the serialization that both the
 * Proof-of-Payable Builder (Dev 2) and the Settlement Adapter (Dev 1) must
 * agree on byte-for-byte before anything gets signed.
 *
 * See `Pakta_Division_Trabajo.md` §7 and `Pakta_Division_Trabajo.md` §7. This module
 * only covers `proof_hash = SHA-256(UTF-8(JCS(unsigned_proof)))`. The
 * `registration_digest` that the contract recalculates is a separate, binary
 * encoding and is deliberately NOT here — it depends on the contract id and
 * SAC address, which are still pending the v1.1 agreement.
 *
 * Stricter than plain RFC 8785 in one respect, per the Day 0 review: floats
 * and unsafe integers are rejected rather than serialized. A proof is money;
 * a value whose text form depends on floating-point formatting has no place
 * in a signed payload.
 */

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * A lone surrogate has no UTF-8 encoding, so it cannot produce stable bytes
 * across languages. RFC 8785 makes it an error; `JSON.stringify` would
 * silently emit an escape instead.
 */
function hasLoneSurrogate(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function serializeString(value: string, path: string): string {
  if (hasLoneSurrogate(value)) {
    throw new CanonicalizationError(`${path}: string contains an unpaired surrogate`);
  }
  // JSON.stringify already matches RFC 8785 §3.2.2.2 for well-formed strings:
  // short escapes where they exist, \u00XX for other control characters, and
  // non-ASCII left as raw UTF-8.
  return JSON.stringify(value);
}

function serializeNumber(value: number, path: string): string {
  if (!Number.isInteger(value)) {
    throw new CanonicalizationError(
      `${path}: only integers are canonicalizable — money must travel as a decimal string, not a float`,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalizationError(`${path}: integer is outside the safe range`);
  }
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serialize(value: unknown, path: string): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return serializeNumber(value, path);
  if (typeof value === "string") return serializeString(value, path);

  if (Array.isArray(value)) {
    const items = value.map((item, index) => serialize(item, `${path}[${index}]`));
    return `[${items.join(",")}]`;
  }

  if (isPlainObject(value)) {
    // RFC 8785 sorts by UTF-16 code units, which is exactly what the default
    // string comparison does in JS. Sorting is what makes key order irrelevant
    // to the hash.
    const keys = Object.keys(value).sort();
    const members = keys.map((key) => {
      const child = value[key];
      if (child === undefined) {
        throw new CanonicalizationError(
          `${path}.${key}: undefined has no JSON form — omit the key or use null`,
        );
      }
      return `${serializeString(key, `${path}.${key}`)}:${serialize(child, `${path}.${key}`)}`;
    });
    return `{${members.join(",")}}`;
  }

  throw new CanonicalizationError(`${path}: ${typeof value} is not canonicalizable`);
}

/** The exact string whose UTF-8 bytes get hashed. Exported so vectors can assert on it, not just on the digest. */
export function canonicalize(value: JsonValue): string {
  return serialize(value, "$");
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Fields that wrap a proof but are never part of what gets signed: the hash
 * itself, the signature, and the deployment metadata that only binds the
 * `registration_digest`. Shape proposed in `Pakta_Division_Trabajo.md` §7 and still
 * pending Dev 2's agreement — passed as data, not baked into the hash, so the
 * function survives the negotiation.
 */
export const SIGNATURE_ENVELOPE_KEYS = [
  "proof_hash",
  "issuer_public_key",
  "issuer_signature",
  "network_passphrase",
  "contract_id",
] as const;

export function stripEnvelope(
  signedProof: Readonly<Record<string, JsonValue>>,
  envelopeKeys: readonly string[] = SIGNATURE_ENVELOPE_KEYS,
): Record<string, JsonValue> {
  const excluded = new Set(envelopeKeys);
  const unsigned: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(signedProof)) {
    if (!excluded.has(key)) unsigned[key] = value;
  }
  return unsigned;
}

/** `proof_hash` as 64 lowercase hex characters, no `0x` prefix. */
export function proofHash(unsignedProof: Readonly<Record<string, JsonValue>>): string {
  return sha256Hex(canonicalize(unsignedProof));
}
