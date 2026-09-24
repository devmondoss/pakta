/**
 * Prints the raw 32-byte Ed25519 public key behind a Stellar `G...` account as
 * the 64 lowercase hex characters that `initialize --issuers` expects.
 *
 * Uses Pakta's own StrKey decoder on purpose: the bytes the gate is configured
 * with then come from the exact code that builds the registration digest, so a
 * mismatch is impossible by construction.
 *
 *   npx tsx scripts/issuer-hex.ts GABC...
 */
import { decodeAccountId } from "../packages/stellar-sdk-wrapper/src/index.js";

const account = process.argv[2];
if (!account) {
  process.stderr.write("usage: npx tsx scripts/issuer-hex.ts <G...>\n");
  process.exit(1);
}

process.stdout.write(`${Buffer.from(decodeAccountId(account)).toString("hex")}\n`);
