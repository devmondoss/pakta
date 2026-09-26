import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb, resetDb, TEST_SCHEMA, type Db } from "../src/db.js";
import { attestWallet, getWallet, registerWalletChange, seedWalletIfAbsent } from "../src/vendorWallets.js";

let db: Db;

beforeAll(async () => {
  db = await openDb(process.env.DATABASE_URL!, TEST_SCHEMA);
});

beforeEach(async () => {
  await resetDb(db);
});

describe("seedWalletIfAbsent", () => {
  it("inserts a wallet that doesn't exist yet", async () => {
    await seedWalletIfAbsent(db, {
      vendorId: "VEN-001",
      address: "GA1...",
      attestationStatus: "ATTESTED",
      version: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(await getWallet(db, "VEN-001")).toMatchObject({ address: "GA1...", version: 1 });
  });

  it("never overwrites an existing row", async () => {
    await seedWalletIfAbsent(db, {
      vendorId: "VEN-001",
      address: "GA1...",
      attestationStatus: "ATTESTED",
      version: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await seedWalletIfAbsent(db, {
      vendorId: "VEN-001",
      address: "GA2-DIFFERENT",
      attestationStatus: "ATTESTED",
      version: 99,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(await getWallet(db, "VEN-001")).toMatchObject({ address: "GA1...", version: 1 });
  });
});

describe("the HU-D2-15 reverification flow", () => {
  it("registering a new wallet marks it UNATTESTED and bumps the version", async () => {
    await seedWalletIfAbsent(db, {
      vendorId: "VEN-004",
      address: "GAKX9F1D3RTMLPZQ7N2WYH5V",
      attestationStatus: "ATTESTED",
      version: 6,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });

    const updated = await registerWalletChange(db, "VEN-004", "GNEW-ADDRESS", new Date("2026-09-24T00:00:00Z"));

    expect(updated).toMatchObject({
      vendorId: "VEN-004",
      address: "GNEW-ADDRESS",
      attestationStatus: "UNATTESTED",
      version: 7,
    });
  });

  it("registering a wallet for a brand-new vendor starts at version 1", async () => {
    const updated = await registerWalletChange(db, "VEN-NEW", "GBRAND-NEW", new Date("2026-09-24T00:00:00Z"));
    expect(updated).toMatchObject({ version: 1, attestationStatus: "UNATTESTED" });
  });

  it("attesting flips the current wallet to ATTESTED without changing address/version", async () => {
    await registerWalletChange(db, "VEN-004", "GNEW-ADDRESS", new Date("2026-09-24T00:00:00Z"));
    const attested = await attestWallet(db, "VEN-004");

    expect(attested).toMatchObject({ address: "GNEW-ADDRESS", version: 1, attestationStatus: "ATTESTED" });
  });

  it("refuses to attest a vendor with no wallet on file", async () => {
    await expect(attestWallet(db, "VEN-DOES-NOT-EXIST")).rejects.toThrow();
  });
});
