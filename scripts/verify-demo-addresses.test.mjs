import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/stellar-testnet-addresses.json", import.meta.url), "utf8"),
);

function decodeAccountId(address) {
  assert.match(address, /^G[A-Z2-7]{55}$/);
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of address) {
    const digit = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    assert.notEqual(digit, -1);
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
    value &= (1 << bits) - 1;
  }
  assert.equal(bits, 0);
  assert.equal(bytes.length, 35);
  assert.equal(bytes[0], 6 << 3); // Stellar account ID version byte.

  let crc = 0;
  for (const byte of bytes.slice(0, 33)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  assert.equal(bytes[33], crc & 0xff);
  assert.equal(bytes[34], crc >> 8);
}

test("las cinco wallets de vendor son Stellar account IDs válidas y distintas", () => {
  assert.equal(fixture.network, "testnet");
  const vendorIds = Object.keys(fixture.vendors);
  assert.deepEqual(vendorIds, ["VEN-001", "VEN-002", "VEN-003", "VEN-004", "VEN-005"]);
  const wallets = Object.values(fixture.vendors);
  assert.equal(new Set(wallets).size, 5);
  wallets.forEach(decodeAccountId);
});

test("INV-004 conserva un destino cambiado válido y distinto", () => {
  decodeAccountId(fixture.invoice_004_changed_wallet);
  assert.notEqual(fixture.invoice_004_changed_wallet, fixture.vendors["VEN-004"]);
  assert.ok(!Object.values(fixture.vendors).includes(fixture.invoice_004_changed_wallet));
});
