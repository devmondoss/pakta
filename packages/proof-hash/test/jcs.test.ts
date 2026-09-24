import { describe, expect, it } from "vitest";
import {
  CanonicalizationError,
  SIGNATURE_ENVELOPE_KEYS,
  canonicalize,
  proofHash,
  sha256Hex,
  stripEnvelope,
  type JsonValue,
} from "../src/jcs.js";

/**
 * Parity vectors for `Pakta_Plan_Web3_Stellar.md` D3. These are the values the
 * Rust side must reproduce byte-for-byte once `register_payable` exists — the
 * whole point of pinning them now is that a divergence surfaces here and not
 * in a failed settlement during the demo.
 */

/** Shape of `Pakta_Documento_Maestro.md` §6.1 plus `receipt_hash`, with a real testnet wallet (VEN-004). */
const UNSIGNED_PROOF: Record<string, JsonValue> = {
  payable_id: "PAY-2026-9182",
  invoice_hash: "a".repeat(64),
  po_hash: "b".repeat(64),
  receipt_hash: "c".repeat(64),
  approvals_hash: "d".repeat(64),
  vendor_id: "VEN-004",
  vendor_wallet: "GCWHVCDLQWRHPXUJFSSM2J6PEFUHLDBZ77XRWQM5MA3ULYMYY3K7EPNO",
  wallet_attestation_version: 6,
  amount: "8000.00",
  asset: "USDC",
  policy_version: "FIN-4.2",
  cost_center: "INFRA-042",
  expires_at: "2026-09-25T18:00:00Z",
  status: "READY",
};

const EXPECTED_CANONICAL =
  '{"amount":"8000.00","approvals_hash":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","asset":"USDC","cost_center":"INFRA-042","expires_at":"2026-09-25T18:00:00Z","invoice_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","payable_id":"PAY-2026-9182","po_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","policy_version":"FIN-4.2","receipt_hash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","status":"READY","vendor_id":"VEN-004","vendor_wallet":"GCWHVCDLQWRHPXUJFSSM2J6PEFUHLDBZ77XRWQM5MA3ULYMYY3K7EPNO","wallet_attestation_version":6}';

const EXPECTED_HASH = "0218cfa6ab5a1bee3ae8827f94037542745abca1f1e69711c1961e37014043a4";

describe("the canonical proof vector", () => {
  it("serializes to the exact pinned string", () => {
    expect(canonicalize(UNSIGNED_PROOF)).toBe(EXPECTED_CANONICAL);
  });

  it("hashes to the exact pinned digest, 64 lowercase hex, no 0x", () => {
    const hash = proofHash(UNSIGNED_PROOF);
    expect(hash).toBe(EXPECTED_HASH);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is unaffected by key order — the property that makes two independent builders agree", () => {
    const shuffled = Object.fromEntries(
      Object.entries(UNSIGNED_PROOF).reverse(),
    ) as Record<string, JsonValue>;
    expect(Object.keys(shuffled)).not.toEqual(Object.keys(UNSIGNED_PROOF));
    expect(proofHash(shuffled)).toBe(EXPECTED_HASH);
  });

  it.each([
    ["amount", "8000.01"],
    ["vendor_wallet", "GBULRZJR3HMP4DRBMT5OFCO6RIX7QYUC5PVHBCZXXLTBLRTYKZQYIVIN"],
    ["expires_at", "2026-09-25T18:00:01Z"],
    ["payable_id", "PAY-2026-9183"],
  ])("changes the digest when %s changes", (field, value) => {
    expect(proofHash({ ...UNSIGNED_PROOF, [field]: value })).not.toBe(EXPECTED_HASH);
  });

  it("changes the digest when a field is added or removed", () => {
    const { cost_center: _dropped, ...without } = UNSIGNED_PROOF;
    expect(proofHash(without)).not.toBe(EXPECTED_HASH);
    expect(proofHash({ ...UNSIGNED_PROOF, extra: "x" })).not.toBe(EXPECTED_HASH);
  });
});

describe("stripEnvelope", () => {
  it("removes exactly the signature envelope, leaving the signed payload", () => {
    const signed: Record<string, JsonValue> = {
      ...UNSIGNED_PROOF,
      proof_hash: EXPECTED_HASH,
      issuer_public_key: "GCHMGWSGJS4CNBLWF2SBQVUGAF674RWCT5DFK5QENPVL6UCLAXQT2MVL",
      issuer_signature: "ZmFrZS1zaWduYXR1cmU=",
      network_passphrase: "Test SDF Network ; September 2015",
      contract_id: "CB5GBGSEAHW3QWVZL25BQU672MHF7UBRAGD4PA3T5V57RQO7LMKJHA2N",
    };

    expect(stripEnvelope(signed)).toEqual(UNSIGNED_PROOF);
    // The round trip an adapter performs: recompute from the received object
    // and reject any mismatch against the claimed proof_hash.
    expect(proofHash(stripEnvelope(signed))).toBe(signed.proof_hash);
  });

  it("takes the excluded keys as data, so the v1.1 negotiation cannot silently change the digest", () => {
    expect(SIGNATURE_ENVELOPE_KEYS).toContain("issuer_signature");
    const stripped = stripEnvelope({ a: "1", b: "2" }, ["b"]);
    expect(stripped).toEqual({ a: "1" });
  });
});

describe("values that must be rejected rather than serialized", () => {
  it("rejects floats — money is a decimal string, never a float", () => {
    expect(() => canonicalize({ amount: 8000.01 })).toThrow(CanonicalizationError);
  });

  it("rejects integers outside the safe range", () => {
    expect(() => canonicalize({ n: 2 ** 53 })).toThrow(CanonicalizationError);
  });

  it("rejects NaN and Infinity", () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow(CanonicalizationError);
    expect(() => canonicalize({ n: Number.POSITIVE_INFINITY })).toThrow(CanonicalizationError);
  });

  it("rejects undefined instead of dropping the key, which would change the digest silently", () => {
    expect(() => canonicalize({ a: undefined } as unknown as JsonValue)).toThrow(
      CanonicalizationError,
    );
  });

  it("rejects non-JSON values that would otherwise stringify by coercion", () => {
    expect(() => canonicalize({ d: new Date(0) } as unknown as JsonValue)).toThrow(
      CanonicalizationError,
    );
    expect(() => canonicalize({ n: 1n } as unknown as JsonValue)).toThrow(CanonicalizationError);
  });

  it("rejects unpaired surrogates, which have no UTF-8 encoding", () => {
    expect(() => canonicalize({ s: "\ud800" })).toThrow(CanonicalizationError);
  });
});

describe("string and structure handling", () => {
  it("escapes control characters and quotes, and leaves non-ASCII as raw UTF-8", () => {
    expect(canonicalize({ s: 'a"b\\c\nd' })).toBe('{"s":"a\\"b\\\\c\\nd"}');
    expect(canonicalize({ s: "logística ñ 日本" })).toBe('{"s":"logística ñ 日本"}');
  });

  it("preserves array order while still sorting object keys inside it", () => {
    expect(canonicalize({ xs: [{ b: 2, a: 1 }, "z", 1] })).toBe('{"xs":[{"a":1,"b":2},"z",1]}');
  });

  it("sorts by UTF-16 code unit, so uppercase sorts before lowercase", () => {
    expect(canonicalize({ b: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"b":1}');
  });

  it("hashes UTF-8 bytes — sha256 of the empty string is the known constant", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
