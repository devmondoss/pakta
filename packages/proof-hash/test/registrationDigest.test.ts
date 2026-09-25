import { describe, expect, it } from "vitest";
import {
  DOMAIN_SEPARATOR,
  REGISTRATION_PREIMAGE_BYTES,
  ATTESTATION_PHASE_SYMBOL,
  ATTESTATION_PREIMAGE_BYTES,
  ATTEST_DOMAIN_SEPARATOR,
  REVOCATION_PREIMAGE_BYTES,
  REVOKE_DOMAIN_SEPARATOR,
  RegistrationDigestError,
  isoToUnixSeconds,
  registrationDigestHex,
  registrationPreimage,
  attestationDigestHex,
  attestationPreimage,
  revocationDigestHex,
  revocationPreimage,
  type AttestationInput,
  type RegistrationInput,
  type RevocationInput,
} from "../src/registrationDigest.js";

/**
 * Parity vectors for the `registration_digest` of `Pakta_Division_Trabajo.md` §7.
 * Every value below is a real testnet identifier from `deployments/testnet.json`,
 * so the Rust side can be pointed at the same manifest and must land on the
 * same 32 bytes.
 */

const INPUT: RegistrationInput = {
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CB5GBGSEAHW3QWVZL25BQU672MHF7UBRAGD4PA3T5V57RQO7LMKJHA2N",
  payableId: "PAY-2026-9182",
  proofHash: "0218cfa6ab5a1bee3ae8827f94037542745abca1f1e69711c1961e37014043a4",
  recipient: "GCWHVCDLQWRHPXUJFSSM2J6PEFUHLDBZ77XRWQM5MA3ULYMYY3K7EPNO",
  assetContractId: "CAMYM3CR6YM6Y3PUI7NMBJJ3SHWUKDFPRC4C722OOXZG3ZUUFW3ROF5P",
  amountUnits: 80_000_000_000n,
  policyVersion: "FIN-4.2",
  expiryUnixSeconds: 1_790_359_200,
};

const EXPECTED_PREIMAGE_HEX =
  "50414b54415f5245475f563100" +
  "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472" +
  "7a609a4401edb85ab95eba1853dfd30e5fd0310187c78373ed7bf8c1df5b1493" +
  "9ad58d1bb77a22e8944cbd6f92965ee2e987772a1389e856d567b69346206ca5" +
  "0218cfa6ab5a1bee3ae8827f94037542745abca1f1e69711c1961e37014043a4" +
  "ac7a886b85a277de892ca4cd27cf2168758c39ffef1b419d603745e198c6d5f2" +
  "19866c51f619ec6df447dac0a53b91ed450caf88b82feb4e75f26de6942db717" +
  "000000000000000000000012a05f2000" +
  "368b8ba646b0e0cc299db9c59f94015b605d859e0a636d61221228d2ca59f893" +
  "000000006ab6b6a0";

const EXPECTED_DIGEST = "9d6457ba4beb977d7a27a3106a0ef4dc55673b9718dbbb2e05e411c2764233db";

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("the registration digest vector", () => {
  it("builds the exact pinned 261-byte preimage", () => {
    const preimage = registrationPreimage(INPUT);
    expect(preimage).toHaveLength(REGISTRATION_PREIMAGE_BYTES);
    expect(hex(preimage)).toBe(EXPECTED_PREIMAGE_HEX);
  });

  it("hashes to the exact pinned digest", () => {
    expect(registrationDigestHex(INPUT)).toBe(EXPECTED_DIGEST);
  });

  it("places every field at the offset the encoding table specifies", () => {
    const preimage = registrationPreimage(INPUT);
    const at = (start: number, length: number) => hex(preimage.subarray(start, start + length));

    expect(Buffer.from(preimage.subarray(0, 12)).toString("ascii")).toBe(DOMAIN_SEPARATOR);
    expect(preimage[12]).toBe(0x00);
    // The network id is the SHA-256 of the passphrase, which is also what
    // deployments/testnet.json records — a mismatch here means the manifest lies.
    expect(at(13, 32)).toBe("cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472");
    expect(at(109, 32)).toBe(INPUT.proofHash);
    expect(at(205, 16)).toBe("000000000000000000000012a05f2000"); // 80_000_000_000 as i128 BE
    expect(at(253, 8)).toBe("000000006ab6b6a0"); // 1_790_359_200 as u64 BE
  });
});

describe("what the signature actually binds", () => {
  const mutations: Array<[string, Partial<RegistrationInput>]> = [
    ["the network", { networkPassphrase: "Public Global Stellar Network ; September 2015" }],
    ["the gate contract", { contractId: "CAMYM3CR6YM6Y3PUI7NMBJJ3SHWUKDFPRC4C722OOXZG3ZUUFW3ROF5P" }],
    ["the payable id", { payableId: "PAY-2026-9183" }],
    ["the proof hash", { proofHash: `${"0".repeat(63)}1` }],
    ["the recipient", { recipient: "GBULRZJR3HMP4DRBMT5OFCO6RIX7QYUC5PVHBCZXXLTBLRTYKZQYIVIN" }],
    ["the asset", { assetContractId: "CB5GBGSEAHW3QWVZL25BQU672MHF7UBRAGD4PA3T5V57RQO7LMKJHA2N" }],
    ["the amount", { amountUnits: 80_000_000_001n }],
    ["the policy version", { policyVersion: "FIN-4.3" }],
    ["the expiry", { expiryUnixSeconds: 1_790_359_201 }],
  ];

  it.each(mutations)("changing %s invalidates the digest", (_label, override) => {
    expect(registrationDigestHex({ ...INPUT, ...override })).not.toBe(EXPECTED_DIGEST);
  });

  it("covers every mutable field of the encoding table", () => {
    // Domain is the tenth field and is constant, hence 9 mutations.
    expect(mutations).toHaveLength(9);
  });

  it("is the reason a proof cannot be replayed against another deployment", () => {
    // Same proof, same vendor, same money — different gate. Different digest,
    // so the issuer's signature does not carry over.
    const otherGate = registrationDigestHex({
      ...INPUT,
      contractId: "CAMYM3CR6YM6Y3PUI7NMBJJ3SHWUKDFPRC4C722OOXZG3ZUUFW3ROF5P",
    });
    expect(otherGate).not.toBe(EXPECTED_DIGEST);
  });
});

describe("inputs that must be rejected", () => {
  it("rejects an amount that is zero or negative", () => {
    expect(() => registrationPreimage({ ...INPUT, amountUnits: 0n })).toThrow(/positive/);
    expect(() => registrationPreimage({ ...INPUT, amountUnits: -1n })).toThrow(/positive/);
  });

  it("rejects an amount that is not a bigint, which is how a float sneaks in", () => {
    expect(() =>
      registrationPreimage({ ...INPUT, amountUnits: 8000 as unknown as bigint }),
    ).toThrow(/bigint/);
  });

  it("rejects a proof hash that is not 64 lowercase hex", () => {
    expect(() => registrationPreimage({ ...INPUT, proofHash: `0x${INPUT.proofHash}` })).toThrow(
      /64 lowercase hex/,
    );
    expect(() =>
      registrationPreimage({ ...INPUT, proofHash: INPUT.proofHash.toUpperCase() }),
    ).toThrow(/64 lowercase hex/);
  });

  it("rejects a malformed recipient or contract id rather than hashing garbage", () => {
    expect(() => registrationPreimage({ ...INPUT, recipient: "GA1CD9F3KXQPLMN7R2WZT8VY" })).toThrow();
    expect(() => registrationPreimage({ ...INPUT, contractId: INPUT.recipient })).toThrow(
      /version byte/,
    );
  });

  it("rejects an expiry outside u64", () => {
    expect(() => registrationPreimage({ ...INPUT, expiryUnixSeconds: -1 })).toThrow(/u64/);
  });

  it.each(["networkPassphrase", "payableId", "policyVersion"] as const)(
    "rejects an empty %s",
    (field) => {
      expect(() => registrationPreimage({ ...INPUT, [field]: "" })).toThrow(/non-empty/);
    },
  );
});

describe("isoToUnixSeconds", () => {
  it("converts the canonical UTC form", () => {
    expect(isoToUnixSeconds("2026-09-25T18:00:00Z")).toBe(1_790_359_200);
  });

  it.each([
    ["an offset instead of Z", "2026-09-25T18:00:00+00:00"],
    ["fractional seconds", "2026-09-25T18:00:00.000Z"],
    ["a date with no time", "2026-09-25"],
    ["minute precision only", "2026-09-25T18:00Z"],
    ["a local timestamp", "2026-09-25 18:00:00"],
  ])("rejects %s, which 8 bytes cannot represent unambiguously", (_label, input) => {
    expect(() => isoToUnixSeconds(input)).toThrow(RegistrationDigestError);
  });

  it("rejects a syntactically valid but impossible date", () => {
    expect(() => isoToUnixSeconds("2026-13-45T99:00:00Z")).toThrow(RegistrationDigestError);
  });
});

describe("the revocation digest vector (V2)", () => {
  const REVOCATION: RevocationInput = {
    networkPassphrase: INPUT.networkPassphrase,
    contractId: INPUT.contractId,
    payableId: INPUT.payableId,
    proofHash: INPUT.proofHash,
    reasonCode: "VENDOR_WALLET_CHANGED",
  };

  const EXPECTED_REVOCATION_DIGEST =
    "795f6762ec74115526849f4d61ff677148e8fc9fe8161990e71917613a15c387";

  it("builds a 173-byte preimage and hashes to the pinned digest", () => {
    expect(revocationPreimage(REVOCATION)).toHaveLength(REVOCATION_PREIMAGE_BYTES);
    expect(revocationDigestHex(REVOCATION)).toBe(EXPECTED_REVOCATION_DIGEST);
  });

  it("uses its own V2 domain, so neither a registration nor a V1 revocation signature fits", () => {
    const preimage = revocationPreimage(REVOCATION);
    expect(Buffer.from(preimage.subarray(0, 12)).toString("ascii")).toBe("PAKTA_REV_V2");
    expect(REVOKE_DOMAIN_SEPARATOR).not.toBe(DOMAIN_SEPARATOR);
    expect(revocationDigestHex(REVOCATION)).not.toBe(EXPECTED_DIGEST);
  });

  it.each([
    ["the network", { networkPassphrase: "Public Global Stellar Network ; September 2015" }],
    ["the gate contract", { contractId: "CAMYM3CR6YM6Y3PUI7NMBJJ3SHWUKDFPRC4C722OOXZG3ZUUFW3ROF5P" }],
    ["the payable id", { payableId: "PAY-2026-9183" }],
    ["the proof hash", { proofHash: `${"0".repeat(63)}1` }],
    // New in V2: the reason is signed, so it cannot be rewritten by whoever submits.
    ["the reason", { reasonCode: "STALE_EVIDENCE" }],
  ])("changing %s invalidates the revocation digest", (_label, override) => {
    expect(revocationDigestHex({ ...REVOCATION, ...override })).not.toBe(EXPECTED_REVOCATION_DIGEST);
  });
});

describe("the attestation digest vector", () => {
  const ATTESTATION: AttestationInput = {
    networkPassphrase: INPUT.networkPassphrase,
    contractId: INPUT.contractId,
    payableId: INPUT.payableId,
    phase: "blocked",
    reasonCode: "VENDOR_WALLET_CHANGED",
    sequence: 1,
  };

  const EXPECTED_ATTESTATION_DIGEST =
    "7dea7c29a2950c5cf6e2748f9ba149a5522a979ea5dfd788db8902440da71fe9";

  it("builds a 150-byte preimage and hashes to the pinned digest", () => {
    expect(attestationPreimage(ATTESTATION)).toHaveLength(ATTESTATION_PREIMAGE_BYTES);
    expect(attestationDigestHex(ATTESTATION)).toBe(EXPECTED_ATTESTATION_DIGEST);
  });

  it("puts the phase code and sequence where the contract reads them", () => {
    const preimage = attestationPreimage(ATTESTATION);
    expect(Buffer.from(preimage.subarray(0, 12)).toString("ascii")).toBe(ATTEST_DOMAIN_SEPARATOR);
    expect(preimage[109]).toBe(0); // blocked
    expect(Buffer.from(preimage.subarray(142, 150)).toString("hex")).toBe("0000000000000001");
  });

  it.each([
    ["the phase", { phase: "resolved" as const }],
    ["the reason", { reasonCode: "MISSING_RECEIPT" }],
    ["the sequence", { sequence: 2 }],
    ["the payable id", { payableId: "PAY-2026-9183" }],
    ["the gate contract", { contractId: "CAMYM3CR6YM6Y3PUI7NMBJJ3SHWUKDFPRC4C722OOXZG3ZUUFW3ROF5P" }],
  ])("changing %s invalidates the attestation digest", (_label, override) => {
    expect(attestationDigestHex({ ...ATTESTATION, ...override })).not.toBe(EXPECTED_ATTESTATION_DIGEST);
  });

  it("maps phases to the symbols attest_lifecycle expects on-chain", () => {
    expect(ATTESTATION_PHASE_SYMBOL.reconciled).toBe("reconcil");
    expect(Object.values(ATTESTATION_PHASE_SYMBOL).every((symbol) => symbol.length <= 9)).toBe(true);
  });

  it("rejects an unknown phase rather than hashing a guess", () => {
    expect(() =>
      attestationPreimage({ ...ATTESTATION, phase: "settled" as unknown as AttestationInput["phase"] }),
    ).toThrow(RegistrationDigestError);
  });
});
