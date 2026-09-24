import type { VendorWallet } from "@pakta/canonical-model";
import type { Db } from "./db.js";

type WalletRow = {
  vendor_id: string;
  address: string;
  attestation_status: "ATTESTED" | "UNATTESTED";
  version: number;
  created_at: string;
};

function toVendorWallet(row: WalletRow): VendorWallet {
  return {
    vendorId: row.vendor_id,
    address: row.address,
    attestationStatus: row.attestation_status,
    version: row.version,
    createdAt: new Date(row.created_at),
  };
}

export function getWallet(db: Db, vendorId: string): VendorWallet | undefined {
  const row = db.prepare("SELECT * FROM vendor_wallets WHERE vendor_id = ?").get(vendorId) as
    | WalletRow
    | undefined;
  return row ? toVendorWallet(row) : undefined;
}

/** Only inserts if the vendor has no wallet on file yet — used to seed from the fixture without ever clobbering a reverification that already happened. */
export function seedWalletIfAbsent(db: Db, wallet: VendorWallet): void {
  db.prepare(
    `INSERT INTO vendor_wallets (vendor_id, address, attestation_status, version, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (vendor_id) DO NOTHING`,
  ).run(wallet.vendorId, wallet.address, wallet.attestationStatus, wallet.version, wallet.createdAt.toISOString());
}

/**
 * HU-D2-15 step 1: the vendor claims a new payout address. Recorded as
 * UNATTESTED — this alone is what makes `walletAttestation`/the kernel's
 * `VENDOR_WALLET_CHANGED` rule fire on the next evaluation, exactly the
 * same as an invoice showing up with an unrecognized wallet.
 */
export function registerWalletChange(db: Db, vendorId: string, address: string, now: Date): VendorWallet {
  const current = getWallet(db, vendorId);
  const nextVersion = (current?.version ?? 0) + 1;

  db.prepare(
    `INSERT INTO vendor_wallets (vendor_id, address, attestation_status, version, created_at)
     VALUES (?, ?, 'UNATTESTED', ?, ?)
     ON CONFLICT (vendor_id) DO UPDATE SET
       address = excluded.address,
       attestation_status = excluded.attestation_status,
       version = excluded.version,
       created_at = excluded.created_at`,
  ).run(vendorId, address, nextVersion, now.toISOString());

  return getWallet(db, vendorId)!;
}

/**
 * HU-D2-15 step 2: a human confirms the address on file is really the
 * vendor's (out of band — a phone call, a signed letter, whatever the
 * policy requires). Clears `UNATTESTED_WALLET`/`VENDOR_WALLET_CHANGED` on
 * the payable the next time it's evaluated.
 */
export function attestWallet(db: Db, vendorId: string): VendorWallet {
  const current = getWallet(db, vendorId);
  if (!current) throw new Error(`no wallet on file for vendor ${vendorId}`);

  db.prepare("UPDATE vendor_wallets SET attestation_status = 'ATTESTED' WHERE vendor_id = ?").run(vendorId);
  return getWallet(db, vendorId)!;
}
