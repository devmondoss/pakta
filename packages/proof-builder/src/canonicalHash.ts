import { canonicalize, sha256Hex, type JsonValue } from "@pakta/proof-hash";

/**
 * Evidence fingerprints for the Proof-of-Payable's `*_hash` fields.
 *
 * Built on the same JCS (RFC 8785) canonicalization as `proof_hash`, so there
 * is exactly one way to turn an object into bytes anywhere in the system. An
 * earlier version used a local stable-stringify that produced `sha256:<hex>`,
 * which the v1.1 schema — and the settlement adapter — reject: evidence hashes
 * are 64 lowercase hex with no prefix.
 *
 * JCS is deliberately strict (no floats, no undefined, no Dates), and the
 * canonical model carries all three, so values are first projected onto plain
 * JSON:
 *
 *   - Date      -> ISO-8601 string
 *   - undefined -> the key is omitted, matching JSON.stringify
 *   - a non-integer number -> its decimal string, because JCS refuses floats
 *     and a quantity like 1.5 must still hash deterministically
 *
 * Nothing on-chain recomputes these hashes; they are commitments an auditor
 * can reproduce from the evidence. The projection only has to be stable,
 * and it is.
 */
function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`cannot hash a non-finite number: ${value}`);
    return Number.isSafeInteger(value) ? value : String(value);
  }
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child === undefined) continue;
      out[key] = toJsonValue(child);
    }
    return out;
  }
  throw new TypeError(`cannot hash a value of type ${typeof value}`);
}

/** 64 lowercase hex characters, no prefix. */
export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalize(toJsonValue(value)));
}

const DIGEST = /^(?:sha256:)?([0-9a-f]{64})$/;

/**
 * If a `sourceHash` is already a real SHA-256 digest of the source document —
 * with or without a `sha256:` prefix — returns its 64 hex characters.
 * Otherwise returns undefined, and the caller must commit to the evidence some
 * other way.
 *
 * Today neither ingestion path produces a real digest: the workbook carries
 * `sha256:demo-inv-001` and AI extraction writes `sha256:ai-extracted-<id>`.
 * Those are labels, not hashes, and must not be passed off as one.
 */
export function sourceDigest(sourceHash: string): string | undefined {
  return DIGEST.exec(sourceHash)?.[1];
}
