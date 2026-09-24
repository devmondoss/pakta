/**
 * The one place a decimal money string becomes an on-chain integer, and back.
 * See `Pakta_Plan_Web3_Stellar.md` D4.
 *
 * Stellar assets carry 7 decimals, so `"5000.00"` is `50_000_000_000` units.
 * Every rule here exists because the alternative is a wrong payment:
 *
 * - more than 7 decimals throws instead of truncating — silently dropping a
 *   digit pays the wrong amount;
 * - `bigint`, never `number` — 2^53 stroops is only ~900M USDC, and a float
 *   would round long before that;
 * - leading zeros are rejected: `"05000.00"` and `"5000.00"` are the same
 *   money but different bytes, so they would produce different `proof_hash`
 *   values for one obligation.
 *
 * Note that `@pakta/canonical-model` is stricter still — its `decimalString`
 * allows at most 2 decimals. That is Dev 2's business rule for invoice
 * amounts; this converter accepts the full 7 the chain supports, so it stays
 * correct if that rule ever loosens.
 */

export const ASSET_DECIMALS = 7;

const UNITS_PER_WHOLE = 10n ** BigInt(ASSET_DECIMALS);

/** Soroban's `i128` upper bound. A proof above this cannot be registered at all. */
export const I128_MAX = 2n ** 127n - 1n;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

/**
 * `"5000.00"` -> `50000000000n`.
 *
 * Rejects zero, signs, exponents, whitespace, leading zeros and anything
 * finer than 7 decimals.
 */
export function decimalToUnits(amount: string): bigint {
  if (typeof amount !== "string") {
    throw new AmountError(`amount must be a string, got ${typeof amount}`);
  }

  const match = DECIMAL_PATTERN.exec(amount);
  if (!match) {
    throw new AmountError(
      `"${amount}" is not a canonical decimal amount — expected digits with an optional fraction, no sign, no exponent, no leading zeros`,
    );
  }

  const [, whole, fraction = ""] = match;
  if (fraction.length > ASSET_DECIMALS) {
    throw new AmountError(
      `"${amount}" has ${fraction.length} decimals but the asset carries ${ASSET_DECIMALS} — refusing to truncate`,
    );
  }

  const units = BigInt(whole!) * UNITS_PER_WHOLE + BigInt(fraction.padEnd(ASSET_DECIMALS, "0"));

  if (units === 0n) {
    throw new AmountError(`"${amount}" is zero — a payable with no amount cannot be settled`);
  }
  if (units > I128_MAX) {
    throw new AmountError(`"${amount}" exceeds what an i128 can hold`);
  }

  return units;
}

/**
 * `50000000000n` -> `"5000.00"`.
 *
 * Trailing zeros are trimmed down to `minFractionDigits`, which defaults to 2
 * so that the 2-decimal strings the canonical model produces survive a round
 * trip unchanged.
 */
export function unitsToDecimal(units: bigint, minFractionDigits = 2): string {
  if (typeof units !== "bigint") {
    throw new AmountError(`units must be a bigint, got ${typeof units}`);
  }
  if (units < 0n) {
    throw new AmountError(`units must not be negative, got ${units}`);
  }
  if (units > I128_MAX) {
    throw new AmountError(`units exceed what an i128 can hold`);
  }
  if (!Number.isInteger(minFractionDigits) || minFractionDigits < 0 || minFractionDigits > ASSET_DECIMALS) {
    throw new AmountError(`minFractionDigits must be an integer in 0..${ASSET_DECIMALS}`);
  }

  const whole = units / UNITS_PER_WHOLE;
  const fraction = (units % UNITS_PER_WHOLE).toString().padStart(ASSET_DECIMALS, "0");

  let trimmed = fraction;
  while (trimmed.length > minFractionDigits && trimmed.endsWith("0")) {
    trimmed = trimmed.slice(0, -1);
  }

  return trimmed.length === 0 ? whole.toString() : `${whole}.${trimmed}`;
}
