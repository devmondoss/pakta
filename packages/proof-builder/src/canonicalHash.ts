import { createHash } from "node:crypto";

/**
 * Deep-sorts object keys (array order is preserved — it's meaningful,
 * e.g. approval order) so the same data always serializes identically
 * regardless of key insertion order.
 */
function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Same `sha256:<hex>` shape as the `source_hash` the demo fixture already
 * carries (see `fixtures/demo-workbook/demo-data.json`) — not a real
 * cryptographic commitment to Dev 1's chain state, just a deterministic
 * fingerprint of the object's content for the Proof-of-Payable's
 * `*_hash` fields.
 */
export function canonicalHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}
