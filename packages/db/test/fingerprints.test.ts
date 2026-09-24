import { beforeEach, describe, expect, it } from "vitest";
import { openDb, type Db } from "../src/db.js";
import { addKnownFingerprint, addSettledFingerprint, getKnownFingerprints, getSettledFingerprints } from "../src/fingerprints.js";

let db: Db;

beforeEach(() => {
  db = openDb(":memory:");
});

it("starts empty", () => {
  expect(getKnownFingerprints(db)).toEqual(new Set());
  expect(getSettledFingerprints(db)).toEqual(new Set());
});

it("records and returns known/settled fingerprints as Sets", () => {
  addKnownFingerprint(db, "VEN-002|3500.00", "INV-1994, recorded 11 days ago");
  addSettledFingerprint(db, "VEN-001|5000.00");

  expect(getKnownFingerprints(db)).toEqual(new Set(["VEN-002|3500.00"]));
  expect(getSettledFingerprints(db)).toEqual(new Set(["VEN-001|5000.00"]));
});

it("is idempotent — inserting the same fingerprint twice doesn't duplicate or throw", () => {
  addKnownFingerprint(db, "VEN-002|3500.00");
  addKnownFingerprint(db, "VEN-002|3500.00");
  expect(getKnownFingerprints(db)).toEqual(new Set(["VEN-002|3500.00"]));
});
