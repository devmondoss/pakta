import { describe, expect, it } from "vitest";
import {
  StrKeyError,
  decodeAccountId,
  decodeContractId,
  encodeAccountId,
  isAccountId,
  isContractId,
} from "../src/strkey.js";

/** Real testnet identifiers from `deployments/testnet.json` and `fixtures/stellar-testnet-addresses.json`. */
const VEN_004 = "GCWHVCDLQWRHPXUJFSSM2J6PEFUHLDBZ77XRWQM5MA3ULYMYY3K7EPNO";
const USDC_SAC = "CAMYM3CR6YM6Y3PUI7NMBJJ3SHWUKDFPRC4C722OOXZG3ZUUFW3ROF5P";

describe("decodeAccountId", () => {
  it("decodes a real account id to 32 bytes", () => {
    const bytes = decodeAccountId(VEN_004);
    expect(bytes).toHaveLength(32);
    expect(Buffer.from(bytes).toString("hex")).toBe(
      "ac7a886b85a277de892ca4cd27cf2168758c39ffef1b419d603745e198c6d5f2",
    );
  });

  it("rejects a contract id — the version byte is what separates the two key types", () => {
    expect(() => decodeAccountId(USDC_SAC)).toThrow(/version byte/);
  });

  it("rejects a corrupted key, because the checksum catches a single wrong character", () => {
    const corrupted = `${VEN_004.slice(0, 10)}X${VEN_004.slice(11)}`;
    expect(corrupted).toHaveLength(56);
    expect(() => decodeAccountId(corrupted)).toThrow(/checksum/);
  });

  it("rejects the placeholder wallets the original demo fixture shipped with", () => {
    // These are the 24-character strings from Pakta_Division_Trabajo.md §4 that could
    // never have settled. This test is what stops one coming back.
    for (const placeholder of [
      "GA1CD9F3KXQPLMN7R2WZT8VY",
      "GB4KP1M9XCLRQZ7N2WYT8VFH",
      "GAKX9F1D3RTMLPZQ7N2WYH5V",
    ]) {
      expect(() => decodeAccountId(placeholder)).toThrow(StrKeyError);
      expect(isAccountId(placeholder)).toBe(false);
    }
  });

  it("rejects base32 characters that do not exist in the alphabet", () => {
    // 0, 1 and 8 are excluded precisely so they cannot be confused with O, I and B.
    const withZero = `GA0${VEN_004.slice(3)}`;
    expect(() => decodeAccountId(withZero)).toThrow(/not a base32 character/);
  });

  it.each([
    ["too short", VEN_004.slice(0, 55)],
    ["too long", `${VEN_004}A`],
    ["empty", ""],
  ])("rejects a key that is %s", (_label, input) => {
    expect(() => decodeAccountId(input)).toThrow(/56 characters/);
  });

  it("rejects a non-string", () => {
    expect(() => decodeAccountId(null as unknown as string)).toThrow(StrKeyError);
  });
});

describe("decodeContractId", () => {
  it("decodes a real SAC contract id to 32 bytes", () => {
    const bytes = decodeContractId(USDC_SAC);
    expect(bytes).toHaveLength(32);
    expect(Buffer.from(bytes).toString("hex")).toBe(
      "19866c51f619ec6df447dac0a53b91ed450caf88b82feb4e75f26de6942db717",
    );
  });

  it("rejects an account id", () => {
    expect(() => decodeContractId(VEN_004)).toThrow(/version byte/);
  });
});

describe("the non-throwing guards", () => {
  it("separates the two key types without throwing", () => {
    expect(isAccountId(VEN_004)).toBe(true);
    expect(isAccountId(USDC_SAC)).toBe(false);
    expect(isContractId(USDC_SAC)).toBe(true);
    expect(isContractId(VEN_004)).toBe(false);
  });
});

describe("encodeAccountId", () => {
  it("is the exact inverse of decodeAccountId", () => {
    expect(encodeAccountId(decodeAccountId(VEN_004))).toBe(VEN_004);
  });

  it("produces the account the issuer's public key is known by", () => {
    // pakta_issuer's public key, as configured in deployments/testnet.json.
    const publicKey = Buffer.from("a5d05a32bb1950efacd757708e1ff71a647b6e6e0130f64e514c35d5703cf6a6", "hex");
    const account = encodeAccountId(new Uint8Array(publicKey));
    expect(isAccountId(account)).toBe(true);
    expect(Buffer.from(decodeAccountId(account)).toString("hex")).toBe(publicKey.toString("hex"));
  });

  it("refuses anything that is not 32 bytes", () => {
    expect(() => encodeAccountId(new Uint8Array(31))).toThrow(StrKeyError);
  });
});
