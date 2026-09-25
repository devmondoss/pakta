import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { openDb, resetDb, TEST_SCHEMA, type Db } from "../src/db.js";
import { addKnownFingerprint, addSettledFingerprint, getKnownFingerprints, getSettledFingerprints } from "../src/fingerprints.js";

let db: Db;

beforeAll(async () => {
  db = await openDb(process.env.DATABASE_URL!, TEST_SCHEMA);
});

beforeEach(async () => {
  await resetDb(db);
});

it("starts empty", async () => {
  expect(await getKnownFingerprints(db)).toEqual(new Set());
  expect(await getSettledFingerprints(db)).toEqual(new Set());
});

it("records and returns known/settled fingerprints as Sets", async () => {
  await addKnownFingerprint(db, "VEN-002|3500.00", "INV-1994, recorded 11 days ago");
  await addSettledFingerprint(db, "VEN-001|5000.00");

  expect(await getKnownFingerprints(db)).toEqual(new Set(["VEN-002|3500.00"]));
  expect(await getSettledFingerprints(db)).toEqual(new Set(["VEN-001|5000.00"]));
});

it("is idempotent — inserting the same fingerprint twice doesn't duplicate or throw", async () => {
  await addKnownFingerprint(db, "VEN-002|3500.00");
  await addKnownFingerprint(db, "VEN-002|3500.00");
  expect(await getKnownFingerprints(db)).toEqual(new Set(["VEN-002|3500.00"]));
});
