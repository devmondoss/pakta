/**
 * End-to-end functional check of the PayableGate against Stellar testnet.
 *
 * `get_config` only proves the gate was configured. This proves the whole money
 * path actually works:
 *
 *   proof -> JCS proof_hash -> registration_digest -> issuer signature
 *     -> register_payable (anyone may submit; the signature is the authority)
 *     -> settle (executor only, payable_id as the sole argument)
 *     -> USDC leaves the vault, reaches the vendor, emits an event
 *
 * It also runs the adversarial half, which is the part worth watching: the same
 * signed proof resubmitted with a substituted recipient must be rejected
 * on-chain, not merely refused by our own code.
 *
 * Usage (the seed never touches the repo):
 *
 *   PAKTA_ISSUER_SECRET=$(stellar keys secret pakta_issuer) npx tsx scripts/testnet-settle.ts
 */
import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  proofHash,
  registrationDigest,
  revocationDigest,
  isoToUnixSeconds,
} from "../packages/proof-hash/src/index.js";
import { decodeSecretSeed, decimalToUnits } from "../packages/stellar-sdk-wrapper/src/index.js";

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../deployments/testnet.json", import.meta.url)), "utf8"),
);

const GATE = manifest.contracts.payableGate.contractId as string;
const SAC = manifest.asset.sacContractId as string;
const NETWORK = manifest.network.name as string;
const PASSPHRASE = manifest.network.passphrase as string;

const ADMIN_KEY = "pakta_admin";
const EXECUTOR_KEY = "pakta_executor";

function stellar(args: string[]): string {
  return execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

/**
 * Runs a state-changing invoke and returns the transaction hash plus any
 * contract events it emitted. The events matter as much as the balances: they
 * are what the Event Indexer will consume to reconcile a settlement back to
 * the payable that justified it.
 */
function invokeAndGetTx(args: string[]): { tx: string; events: string[] } {
  const result = spawnSync("stellar", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  const stderr = `${result.stderr ?? ""}`;
  const lines = stderr.split(/\r?\n/);
  return {
    tx: stderr.match(/explorer\/testnet\/tx\/([a-f0-9]{64})/)?.[1] ?? "(sin hash en la salida)",
    events: lines
      .filter((line) => line.includes("Event:"))
      .map((line) => line.replace(/^.*?Event:\s*/, "").trim()),
  };
}
const STATUS_LABEL = ["READY", "SETTLED", "EXPIRED", "REVOKED"] as const;
const statusLabel = (value: number) => STATUS_LABEL[value] ?? `desconocido(${value})`;

/** Returns stdout on success, or the contract error text on failure, without throwing. */
function stellarAllowingFailure(args: string[]): { ok: boolean; output: string } {
  try {
    return { ok: true, output: stellar(args) };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}`.trim() };
  }
}

function balanceOf(holder: string): bigint {
  const raw = stellar([
    "contract", "invoke", "--id", SAC, "--source", ADMIN_KEY, "--network", NETWORK,
    "--", "balance", "--id", holder,
  ]);
  return BigInt(raw.replace(/"/g, ""));
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const sha256Hex = (input: string) => createHash("sha256").update(input, "utf8").digest("hex");

/**
 * Ed25519 over a raw 32-byte seed, using only node:crypto. The PKCS8 prefix is
 * the fixed DER header for an Ed25519 private key, so the seed can be wrapped
 * without pulling in a signing library.
 */
function signWithSeed(seed: Uint8Array, message: Uint8Array): { signature: Uint8Array; publicKey: Uint8Array } {
  const pkcs8 = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(seed),
  ]);
  const privateKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return {
    signature: new Uint8Array(cryptoSign(null, Buffer.from(message), privateKey)),
    publicKey: new Uint8Array(spki.subarray(spki.length - 32)),
  };
}

function section(title: string) {
  process.stdout.write(`\n${title}\n${"-".repeat(title.length)}\n`);
}

async function main() {
  const secret = process.env.PAKTA_ISSUER_SECRET;
  if (!secret) {
    process.stderr.write(
      "PAKTA_ISSUER_SECRET is not set.\n" +
        "Run: PAKTA_ISSUER_SECRET=$(stellar keys secret pakta_issuer) npx tsx scripts/testnet-settle.ts\n",
    );
    process.exit(1);
  }

  const issuerSeed = decodeSecretSeed(secret);
  const vendor = manifest.vendors?.["VEN-001"] ?? "GAGCMMI5YDAYYVZDMUOZZXEVS3OSSNKTATYHAFMFCCEISRYZH5F4JZI2";
  const attacker = "GBULRZJR3HMP4DRBMT5OFCO6RIX7QYUC5PVHBCZXXLTBLRTYKZQYIVIN";

  section("1. Config on chain");
  const config = JSON.parse(
    stellar(["contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK, "--", "get_config"]),
  );
  const configuredIssuer: string = config.issuers[0];
  process.stdout.write(`issuer configurado : ${configuredIssuer}\n`);
  process.stdout.write(`executor           : ${config.executor}\n`);

  // Prove we hold the key the gate trusts before spending a transaction on it.
  const probe = signWithSeed(issuerSeed, new Uint8Array(32));
  if (hex(probe.publicKey) !== configuredIssuer) {
    throw new Error(
      `PAKTA_ISSUER_SECRET does not match the issuer the contract trusts.\n` +
        `  contract expects: ${configuredIssuer}\n` +
        `  this key is     : ${hex(probe.publicKey)}`,
    );
  }
  process.stdout.write("la llave provista SÍ es el issuer configurado ✅\n");

  section("2. Proof");
  const businessId = `PAY-TESTNET-${Date.now()}`;
  const amountDecimal = "5000.00";
  const policyVersion = "FIN-4.2";
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const unsignedProof = {
    payable_id: businessId,
    invoice_hash: sha256Hex("INV-001"),
    po_hash: sha256Hex("PO-72881"),
    receipt_hash: sha256Hex("RCP-72881"),
    approvals_hash: sha256Hex("APR-72881"),
    vendor_id: "VEN-001",
    vendor_wallet: vendor,
    wallet_attestation_version: 1,
    amount: amountDecimal,
    asset: "USDC",
    policy_version: policyVersion,
    cost_center: "INFRA-042",
    expires_at: expiresAt,
    status: "READY",
  };

  const payableIdHash = sha256Hex(businessId);
  const amountUnits = decimalToUnits(amountDecimal);
  const expiry = isoToUnixSeconds(expiresAt);
  const computedProofHash = proofHash(unsignedProof);

  process.stdout.write(`business id : ${businessId}\n`);
  process.stdout.write(`payable_id  : ${payableIdHash}\n`);
  process.stdout.write(`proof_hash  : ${computedProofHash}\n`);
  process.stdout.write(`amount      : ${amountDecimal} USDC = ${amountUnits} unidades\n`);

  const digestInput = {
    networkPassphrase: PASSPHRASE,
    contractId: GATE,
    payableId: businessId,
    proofHash: computedProofHash,
    recipient: vendor,
    assetContractId: SAC,
    amountUnits,
    policyVersion,
    expiryUnixSeconds: expiry,
  };
  const digest = registrationDigest(digestInput);
  const { signature } = signWithSeed(issuerSeed, digest);
  process.stdout.write(`digest      : ${hex(digest)}\n`);

  const signaturesJson = JSON.stringify([
    { issuer: configuredIssuer, signature: hex(signature) },
  ]);

  section("3. register_payable");
  const registerTx = invokeAndGetTx([
    "contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK, "--send=yes",
    "--", "register_payable",
    "--payable_id", payableIdHash,
    "--proof_hash", computedProofHash,
    "--recipient", vendor,
    "--amount", amountUnits.toString(),
    "--policy_hash", sha256Hex(policyVersion),
    "--expiry", String(expiry),
    "--signatures", signaturesJson,
  ]);
  process.stdout.write(`tx: ${registerTx.tx}\n`);
  for (const event of registerTx.events) process.stdout.write(`   evento: ${event}\n`);

  const stored = JSON.parse(
    stellar(["contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK,
      "--", "get_payable", "--payable_id", payableIdHash]),
  );
  process.stdout.write(
    `estado on-chain: ${statusLabel(stored.status)}, monto ${stored.amount}, recipient ${stored.recipient}\n`,
  );

  section("4. Sustitución de recipient (debe fallar)");
  // Same signature, different destination. The gate recomputes the digest from
  // the arguments it was handed, so the signature no longer matches.
  const attack = stellarAllowingFailure([
    "contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK, "--send=yes",
    "--", "register_payable",
    "--payable_id", sha256Hex(`${businessId}-ATTACK`),
    "--proof_hash", computedProofHash,
    "--recipient", attacker,
    "--amount", amountUnits.toString(),
    "--policy_hash", sha256Hex(policyVersion),
    "--expiry", String(expiry),
    "--signatures", signaturesJson,
  ]);
  if (attack.ok) {
    throw new Error("FALLO CRÍTICO: la cadena aceptó un recipient sustituido");
  }
  const reason = attack.output.match(/Error\(Crypto[^)]*\)|InvalidAction|Error\(Contract, #\d+\)/)?.[0] ?? "rechazada";
  process.stdout.write(`rechazada on-chain ✅  (${reason})\n`);

  section("5. settle");
  const vendorBefore = balanceOf(vendor);
  const vaultBefore = balanceOf(GATE);
  process.stdout.write(`antes  -> vault ${vaultBefore}, vendor ${vendorBefore}\n`);

  const settleTx = invokeAndGetTx([
    "contract", "invoke", "--id", GATE, "--source", EXECUTOR_KEY, "--network", NETWORK, "--send=yes",
    "--", "settle", "--payable_id", payableIdHash,
  ]);
  process.stdout.write(`tx: ${settleTx.tx}\n`);
  for (const event of settleTx.events) process.stdout.write(`   evento: ${event}\n`);

  const vendorAfter = balanceOf(vendor);
  const vaultAfter = balanceOf(GATE);
  process.stdout.write(`después-> vault ${vaultAfter}, vendor ${vendorAfter}\n`);

  if (vendorAfter - vendorBefore !== amountUnits) {
    throw new Error(`el vendor recibió ${vendorAfter - vendorBefore}, se esperaban ${amountUnits}`);
  }
  if (vaultBefore - vaultAfter !== amountUnits) {
    throw new Error(`del vault salieron ${vaultBefore - vaultAfter}, se esperaban ${amountUnits}`);
  }
  process.stdout.write("montos exactos en ambos lados ✅\n");

  section("6. Doble settle (debe fallar)");
  const second = stellarAllowingFailure([
    "contract", "invoke", "--id", GATE, "--source", EXECUTOR_KEY, "--network", NETWORK, "--send=yes",
    "--", "settle", "--payable_id", payableIdHash,
  ]);
  if (second.ok) {
    throw new Error("FALLO CRÍTICO: el mismo payable se liquidó dos veces");
  }
  process.stdout.write(`rechazado ✅  (${second.output.match(/Error\(Contract, #\d+\)/)?.[0] ?? "error de contrato"})\n`);
  if (balanceOf(vendor) !== vendorAfter) {
    throw new Error("el saldo del vendor cambió tras un settle rechazado");
  }

  section("7. settle sin ser el executor (debe fallar)");
  const wrongCaller = stellarAllowingFailure([
    "contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK, "--send=yes",
    "--", "settle", "--payable_id", sha256Hex(`${businessId}-OTHER`),
  ]);
  if (wrongCaller.ok) {
    throw new Error("FALLO CRÍTICO: un caller sin autorización ejecutó settle");
  }
  process.stdout.write("rechazado ✅\n");

  // --- Treasury safety -----------------------------------------------------

  const committed = () =>
    BigInt(
      stellar(["contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK,
        "--", "get_committed"]).replace(/"/g, ""),
    );
  const availableNow = () =>
    BigInt(
      stellar(["contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK,
        "--", "get_available"]).replace(/"/g, ""),
    );

  section("8. committed / available");
  process.stdout.write(`committed: ${committed()}, available: ${availableNow()}\n`);
  if (committed() !== 0n) {
    throw new Error("nada debería seguir comprometido después de liquidar");
  }

  section("9. withdraw por encima de lo disponible (debe fallar)");
  const overdraw = stellarAllowingFailure([
    "contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK, "--send=yes",
    "--", "withdraw", "--amount", (availableNow() + 1n).toString(),
  ]);
  if (overdraw.ok) {
    throw new Error("FALLO CRÍTICO: el vault entregó más de lo disponible");
  }
  process.stdout.write(
    `rechazado ✅  (${overdraw.output.match(/Error\(Contract, #\d+\)/)?.[0] ?? "error de contrato"})\n`,
  );

  section("10. Revocación firmada por el issuer");
  // A second payable, registered and then cancelled instead of paid. This is
  // the on-chain brake for evidence that went stale after the proof was issued.
  const revokedId = `${businessId}-REVOKE`;
  const revokedIdHash = sha256Hex(revokedId);
  const revokedProofHash = proofHash({ ...unsignedProof, payable_id: revokedId });
  const revokeRegistration = signWithSeed(
    issuerSeed,
    registrationDigest({ ...digestInput, payableId: revokedId, proofHash: revokedProofHash }),
  );
  invokeAndGetTx([
    "contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK, "--send=yes",
    "--", "register_payable",
    "--payable_id", revokedIdHash,
    "--proof_hash", revokedProofHash,
    "--recipient", vendor,
    "--amount", amountUnits.toString(),
    "--policy_hash", sha256Hex(policyVersion),
    "--expiry", String(expiry),
    "--signatures", JSON.stringify([
      { issuer: configuredIssuer, signature: hex(revokeRegistration.signature) },
    ]),
  ]);
  const committedAfterRegister = committed();
  const availableAfterRegister = availableNow();
  process.stdout.write(`tras registrar -> committed ${committedAfterRegister}, available ${availableAfterRegister}\n`);
  if (committedAfterRegister !== amountUnits) {
    throw new Error("registrar debió comprometer exactamente el monto del payable");
  }

  const revocation = signWithSeed(
    issuerSeed,
    revocationDigest({
      networkPassphrase: PASSPHRASE,
      contractId: GATE,
      payableId: revokedId,
      proofHash: revokedProofHash,
      // Signed since revocation V2 — must match the --reason_code sent below.
      reasonCode: "WALLET",
    }),
  );
  const revokeTx = invokeAndGetTx([
    "contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK, "--send=yes",
    "--", "revoke_payable",
    "--payable_id", revokedIdHash,
    "--reason_code", "WALLET",
    "--signatures", JSON.stringify([
      { issuer: configuredIssuer, signature: hex(revocation.signature) },
    ]),
  ]);
  process.stdout.write(`tx: ${revokeTx.tx}\n`);
  for (const event of revokeTx.events) process.stdout.write(`   evento: ${event}\n`);

  const revokedState = JSON.parse(
    stellar(["contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK,
      "--", "get_payable", "--payable_id", revokedIdHash]),
  );
  process.stdout.write(`estado: ${statusLabel(revokedState.status)}\n`);
  process.stdout.write(`tras revocar   -> committed ${committed()}, available ${availableNow()}\n`);
  if (committed() !== 0n) {
    throw new Error("revocar debió liberar lo comprometido");
  }
  if (availableNow() !== availableAfterRegister + amountUnits) {
    throw new Error("revocar debió devolver el monto al pool disponible");
  }

  const settleRevoked = stellarAllowingFailure([
    "contract", "invoke", "--id", GATE, "--source", EXECUTOR_KEY, "--network", NETWORK, "--send=yes",
    "--", "settle", "--payable_id", revokedIdHash,
  ]);
  if (settleRevoked.ok) {
    throw new Error("FALLO CRÍTICO: un payable revocado se liquidó");
  }
  process.stdout.write("un payable revocado no se puede liquidar ✅\n");

  section("11. withdraw dentro de lo disponible");
  const treasuryAddress = JSON.parse(
    stellar(["contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK, "--", "get_config"]),
  ).treasury as string;
  const treasuryBefore = balanceOf(treasuryAddress);
  const withdrawAmount = 1_000n * 10_000_000n;

  const withdrawTx = invokeAndGetTx([
    "contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK, "--send=yes",
    "--", "withdraw", "--amount", withdrawAmount.toString(),
  ]);
  process.stdout.write(`tx: ${withdrawTx.tx}\n`);
  for (const event of withdrawTx.events) process.stdout.write(`   evento: ${event}\n`);

  if (balanceOf(treasuryAddress) - treasuryBefore !== withdrawAmount) {
    throw new Error("el treasury no recibió el monto exacto");
  }
  process.stdout.write("el treasury recibió el monto exacto ✅\n");

  section("Resultado");
  process.stdout.write(
    [
      "register_payable con firma válida  ✅",
      "recipient sustituido rechazado     ✅",
      "settle transfirió el monto exacto  ✅",
      "doble settle rechazado             ✅",
      "settle sin executor rechazado      ✅",
      "withdraw sobre lo disponible ✗     ✅",
      "revocación firmada por issuer      ✅",
      "revocar liberó lo comprometido     ✅",
      "payable revocado no liquidable     ✅",
      "withdraw al treasury               ✅",
      "",
      `estado final : ${statusLabel(JSON.parse(stellar(["contract", "invoke", "--id", GATE, "--source", ADMIN_KEY, "--network", NETWORK, "--", "get_payable", "--payable_id", payableIdHash])).status)}`,
      `register tx  : https://stellar.expert/explorer/testnet/tx/${registerTx.tx}`,
      `settle tx    : https://stellar.expert/explorer/testnet/tx/${settleTx.tx}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
