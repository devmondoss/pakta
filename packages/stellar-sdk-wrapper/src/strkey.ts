/**
 * StrKey decoding — `G...` account ids and `C...` contract ids to their raw
 * 32 bytes.
 *
 * The `registration_digest` of `Pakta_Division_Trabajo.md` §7 is defined over binary
 * keys, not over their text form, precisely so that a signature cannot be
 * replayed by re-encoding the same key differently. That means something has
 * to do this decode, and it has to reject malformed input rather than produce
 * plausible-looking bytes.
 *
 * Implemented here instead of pulling in `@stellar/stellar-sdk` because the
 * proof path should not depend on a large SDK to answer "is this 56-character
 * string really a well-formed account id" — and because the Rust side has to
 * agree byte-for-byte with whatever this produces.
 */

export class StrKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StrKeyError";
  }
}

/** Version byte = value << 3. Only the two kinds the digest needs. */
export const VERSION_BYTE = {
  accountId: 6 << 3, // 'G'
  contract: 2 << 3, // 'C'
  secretSeed: 18 << 3, // 'S'
} as const;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const BASE32_LOOKUP = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < BASE32_ALPHABET.length; i += 1) {
    table[BASE32_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * A 35-byte StrKey payload encodes to exactly 56 base32 characters with no
 * padding, so anything else is malformed by construction.
 */
function base32Decode(encoded: string): Uint8Array {
  if (encoded.length !== 56) {
    throw new StrKeyError(`expected 56 characters, got ${encoded.length}`);
  }

  const out = new Uint8Array(35);
  let bits = 0;
  let value = 0;
  let index = 0;

  for (let i = 0; i < encoded.length; i += 1) {
    const code = encoded.charCodeAt(i);
    const digit = code < 128 ? BASE32_LOOKUP[code]! : -1;
    if (digit < 0) {
      throw new StrKeyError(
        `"${encoded[i]}" at position ${i} is not a base32 character (A-Z, 2-7 — note that 0, 1 and 8 are excluded)`,
      );
    }
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (value >> bits) & 0xff;
      index += 1;
    }
  }

  // 56 * 5 = 280 bits = exactly 35 bytes, so any leftover bits must be zero.
  if (bits > 0 && (value & ((1 << bits) - 1)) !== 0) {
    throw new StrKeyError("trailing bits are not zero — the encoding is malformed");
  }

  return out;
}

/** CRC16-XModem, the checksum Stellar appends to every StrKey, little-endian. */
function crc16XModem(data: Uint8Array): number {
  let crc = 0x0000;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

function decodeStrKey(encoded: string, expectedVersionByte: number, label: string): Uint8Array {
  if (typeof encoded !== "string") {
    throw new StrKeyError(`${label} must be a string, got ${typeof encoded}`);
  }

  const decoded = base32Decode(encoded);
  const versionByte = decoded[0]!;
  if (versionByte !== expectedVersionByte) {
    throw new StrKeyError(
      `${label}: version byte 0x${versionByte.toString(16)} does not match the expected 0x${expectedVersionByte.toString(16)} — wrong key type`,
    );
  }

  const payload = decoded.subarray(1, 33);
  const expectedChecksum = decoded[33]! | (decoded[34]! << 8);
  const actualChecksum = crc16XModem(decoded.subarray(0, 33));
  if (expectedChecksum !== actualChecksum) {
    throw new StrKeyError(`${label}: checksum mismatch — the key is corrupt or mistyped`);
  }

  return new Uint8Array(payload);
}

function base32Encode(data: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function encodeStrKey(payload: Uint8Array, versionByte: number, label: string): string {
  if (payload.length !== 32) {
    throw new StrKeyError(`${label}: expected 32 bytes, got ${payload.length}`);
  }
  const body = new Uint8Array(33);
  body[0] = versionByte;
  body.set(payload, 1);
  const checksum = crc16XModem(body);
  const full = new Uint8Array(35);
  full.set(body, 0);
  full[33] = checksum & 0xff;
  full[34] = (checksum >> 8) & 0xff;
  return base32Encode(full);
}

/** 32 raw ed25519 public-key bytes -> `G...`. */
export function encodeAccountId(publicKey: Uint8Array): string {
  return encodeStrKey(publicKey, VERSION_BYTE.accountId, "account id");
}

/** `G...` -> 32 raw bytes of the ed25519 public key. */
export function decodeAccountId(accountId: string): Uint8Array {
  return decodeStrKey(accountId, VERSION_BYTE.accountId, "account id");
}

/** `C...` -> 32 raw bytes of the contract id. */
export function decodeContractId(contractId: string): Uint8Array {
  return decodeStrKey(contractId, VERSION_BYTE.contract, "contract id");
}

/**
 * `S...` -> the 32 raw seed bytes of an Ed25519 private key.
 *
 * Shares the checksum-validating decoder above rather than being hand-rolled
 * somewhere else, because a silently mis-decoded seed produces a valid-looking
 * signature from the wrong key.
 *
 * Callers handle a secret from here on. It must never be logged, written to a
 * file in the repository, put in an error message, or sent anywhere. Today the
 * only caller is `scripts/testnet-settle.ts`, which reads the seed from an
 * environment variable and keeps it in memory.
 */
export function decodeSecretSeed(seed: string): Uint8Array {
  return decodeStrKey(seed, VERSION_BYTE.secretSeed, "secret seed");
}

/** True when the string is a well-formed account id, checksum included. Never throws. */
export function isAccountId(value: string): boolean {
  try {
    decodeAccountId(value);
    return true;
  } catch {
    return false;
  }
}

/** True when the string is a well-formed contract id, checksum included. Never throws. */
export function isContractId(value: string): boolean {
  try {
    decodeContractId(value);
    return true;
  } catch {
    return false;
  }
}
