import { expect, test } from "bun:test";
import { UtpapCursor, UtpapCursorSchema } from "./utpap-cursor";
import { utpapTestRecord } from "./utpap-test-fixtures";

const photoCursor = {
  source: "utpap",
  version: 2,
  phase: "photos",
  yardCode: "1064",
  history: { vins: [], hashes: [] },
  donors: [
    {
      record: utpapTestRecord,
      photo: "https://utpap.com/Ogden-inventory-photos/A039820.jpeg",
    },
    {
      record: {
        ...utpapTestRecord,
        STOCKNUMBER: "A039846",
        VIN: "2HNYD186X4H538061",
      },
      photo: "https://utpap.com/Ogden-inventory-photos/A039846.jpeg",
    },
  ],
  index: 1,
  rejected: 0,
  emitted: 1,
  vins: [utpapTestRecord.VIN],
  hashes: ["a".repeat(64)],
};
test("Utah checkpoints accept a complete processed donor prefix and the initial cursor", () => {
  expect(UtpapCursorSchema.safeParse(UtpapCursor.initial).success).toBe(true);
  expect(UtpapCursorSchema.safeParse(photoCursor).success).toBe(true);
});
test("Utah rejects checkpoint accounting that skips processed donors", () => {
  expect(
    UtpapCursorSchema.safeParse({ ...photoCursor, emitted: 0 }).success,
  ).toBe(false);
  expect(
    UtpapCursorSchema.safeParse({ ...photoCursor, vins: [] }).success,
  ).toBe(false);
  expect(
    UtpapCursorSchema.safeParse({ ...photoCursor, hashes: [] }).success,
  ).toBe(false);
});
test("Utah checkpoints account exactly for emitted donors without photos", () => {
  const donors = photoCursor.donors.map((donor, index) =>
    index === 0 ? { ...donor, photo: null } : donor,
  );
  expect(
    UtpapCursorSchema.safeParse({ ...photoCursor, donors, hashes: [] }).success,
  ).toBe(true);
  expect(UtpapCursorSchema.safeParse({ ...photoCursor, donors }).success).toBe(
    false,
  );
  expect(
    UtpapCursorSchema.safeParse({
      ...photoCursor,
      donors,
      hashes: [],
      emitted: 0,
      rejected: 1,
    }).success,
  ).toBe(false);
});
test("Utah rejects checkpoints that skip donors for now-optional metadata", () => {
  const donors = photoCursor.donors.map((donor, index) =>
    index === 0
      ? { ...donor, record: { ...donor.record, COLOR: "UNKNOWN" } }
      : donor,
  );
  expect(
    UtpapCursorSchema.safeParse({
      ...photoCursor,
      donors,
      emitted: 0,
      rejected: 1,
      hashes: [],
    }).success,
  ).toBe(false);
});
test("Utah rejects legacy checkpoints even after a previous yard completed", () => {
  expect(
    UtpapCursorSchema.safeParse({
      source: "utpap",
      phase: "start",
      yardCode: "1065",
      history: { vins: photoCursor.vins, hashes: photoCursor.hashes },
    }).success,
  ).toBe(false);
});
test("Utah rejects checkpoint records assigned to a different physical yard", () => {
  expect(
    UtpapCursorSchema.safeParse({ ...photoCursor, yardCode: "1065" }).success,
  ).toBe(false);
});
test("Utah make checkpoints must enumerate the feed's exact make set", () => {
  const cursor = {
    source: "utpap",
    version: 2,
    phase: "makes",
    yardCode: "1064",
    history: { vins: [], hashes: [] },
    records: [utpapTestRecord],
    makes: ["ACURA"],
    index: 0,
    photos: [],
  };
  expect(UtpapCursorSchema.safeParse(cursor).success).toBe(true);
  expect(
    UtpapCursorSchema.safeParse({ ...cursor, makes: ["HONDA"] }).success,
  ).toBe(false);
  expect(
    UtpapCursorSchema.safeParse({ ...cursor, makes: ["ACURA", "ACURA"] })
      .success,
  ).toBe(false);
});
