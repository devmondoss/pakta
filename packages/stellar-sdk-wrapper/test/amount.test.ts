import { describe, expect, it } from "vitest";
import {
  ASSET_DECIMALS,
  AmountError,
  I128_MAX,
  decimalToUnits,
  unitsToDecimal,
} from "../src/amount.js";

describe("decimalToUnits", () => {
  it("converts the five canonical demo amounts", () => {
    // Pakta_Documento_Maestro.md §25 — the invoices the demo actually settles.
    expect(decimalToUnits("5000.00")).toBe(50_000_000_000n);
    expect(decimalToUnits("3500.00")).toBe(35_000_000_000n);
    expect(decimalToUnits("5500.00")).toBe(55_000_000_000n);
    expect(decimalToUnits("8000.00")).toBe(80_000_000_000n);
    expect(decimalToUnits("6400.00")).toBe(64_000_000_000n);
  });

  it("handles whole numbers, short fractions and the full 7 decimals", () => {
    expect(decimalToUnits("1")).toBe(10_000_000n);
    expect(decimalToUnits("0.01")).toBe(100_000n);
    expect(decimalToUnits("0.0000001")).toBe(1n);
    expect(decimalToUnits("1.5")).toBe(15_000_000n);
  });

  it("stays exact past 2^53, where a float would already have rounded", () => {
    const units = decimalToUnits("10000000000.0000001");
    expect(units).toBe(100_000_000_000_000_001n);
    expect(units > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("refuses to truncate an amount finer than the asset's 7 decimals", () => {
    expect(() => decimalToUnits("1.00000001")).toThrow(AmountError);
    expect(() => decimalToUnits("1.00000001")).toThrow(/refusing to truncate/);
  });

  it("rejects zero — a payable with no amount cannot be settled", () => {
    expect(() => decimalToUnits("0")).toThrow(AmountError);
    expect(() => decimalToUnits("0.00")).toThrow(AmountError);
  });

  it("rejects leading zeros, which would give one obligation two different proof hashes", () => {
    expect(() => decimalToUnits("05000.00")).toThrow(AmountError);
    expect(() => decimalToUnits("00.5")).toThrow(AmountError);
  });

  it.each([
    ["negative", "-1.00"],
    ["explicit plus", "+1.00"],
    ["exponent", "1e3"],
    ["surrounding space", " 1.00 "],
    ["thousands separator", "5,000.00"],
    ["trailing dot", "1."],
    ["leading dot", ".5"],
    ["empty", ""],
    ["not a number", "abc"],
  ])("rejects %s", (_label, input) => {
    expect(() => decimalToUnits(input)).toThrow(AmountError);
  });

  it("rejects a non-string, which is how a float sneaks in", () => {
    expect(() => decimalToUnits(5000.0 as unknown as string)).toThrow(AmountError);
  });

  it("rejects an amount beyond i128", () => {
    const tooBig = (I128_MAX / 10n ** BigInt(ASSET_DECIMALS) + 1n).toString();
    expect(() => decimalToUnits(tooBig)).toThrow(/i128/);
  });
});

describe("unitsToDecimal", () => {
  it("renders with 2 decimals by default, matching the canonical model's money format", () => {
    expect(unitsToDecimal(50_000_000_000n)).toBe("5000.00");
    expect(unitsToDecimal(100_000n)).toBe("0.01");
  });

  it("keeps extra precision when the value actually has it", () => {
    expect(unitsToDecimal(1n)).toBe("0.0000001");
    expect(unitsToDecimal(15_000_000n)).toBe("1.50");
  });

  it("honors minFractionDigits at both ends of the range", () => {
    expect(unitsToDecimal(10_000_000n, 0)).toBe("1");
    expect(unitsToDecimal(10_000_000n, 7)).toBe("1.0000000");
  });

  it("rejects negatives, non-bigints and out-of-range precision", () => {
    expect(() => unitsToDecimal(-1n)).toThrow(AmountError);
    expect(() => unitsToDecimal(1 as unknown as bigint)).toThrow(AmountError);
    expect(() => unitsToDecimal(1n, 8)).toThrow(AmountError);
  });
});

describe("round trip", () => {
  it.each(["5000.00", "3500.00", "5500.00", "8000.00", "6400.00", "0.01", "1.50"])(
    "%s survives decimal -> units -> decimal unchanged",
    (amount) => {
      expect(unitsToDecimal(decimalToUnits(amount))).toBe(amount);
    },
  );
});
