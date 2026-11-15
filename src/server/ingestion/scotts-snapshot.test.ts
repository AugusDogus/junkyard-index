import { expect, test } from "bun:test";
import { scottsSnapshot, validateScottsSnapshot } from "./scotts-snapshot";
import { transformScottsRecord } from "./scotts-transform";
import type { ScottsRecord } from "./scotts-parser";
import {
  scottsContext,
  scottsMake,
  scottsModel,
  scottsPage,
  scottsRecords,
} from "./scotts-test-fixtures";

const makes = [{ ...scottsMake, models: [scottsModel] }];
function nativeRecord(): ScottsRecord {
  const row = scottsRecords[0];
  if (!row) throw new Error("Real Scott's donor missing");
  return [...row];
}

test("Scotts quarantines all VIN, destination and required donor-ID collisions regardless of order", () => {
  const first = nativeRecord();
  const second = nativeRecord();
  second[4] = "/used-parts/ACURA/CL/DIFFERENT/1997";
  second[6] = "DIFFERENT";
  for (const records of [
    [first, second],
    [second, first],
  ]) {
    const snapshot = scottsSnapshot(makes, [scottsPage(records)]);
    expect(snapshot.vehicles).toEqual([]);
    expect(snapshot.observedVins).toEqual([first[0]]);
    expect(snapshot.accounting.recordsRejected).toBe(2);
  }
  second[0] = "19UYA2254VL011689";
  second[6] = first[6];
  const collision = scottsSnapshot(makes, [scottsPage([first, second])]);
  expect(collision.vehicles).toEqual([]);
  expect(collision.accounting.recordsRejected).toBe(2);
  expect(collision.observedVins).toHaveLength(2);
});

test("Scotts preserves rejected valid VIN presence, never repairs missing YMM or required join IDs", () => {
  for (const index of [1, 2, 6]) {
    const row = nativeRecord();
    row[index] = "";
    const snapshot = scottsSnapshot(makes, [scottsPage([row])]);
    expect(snapshot.vehicles).toEqual([]);
    expect(snapshot.observedVins).toEqual([row[0]]);
  }
  const modern = nativeRecord();
  modern[0] = "123456789";
  expect(transformScottsRecord(modern, scottsContext)).toEqual({
    status: "incomplete",
    vin: null,
  });
  const older = nativeRecord();
  older[0] = "ABC123456";
  older[1] = "1970";
  older[4] = "/used-parts/ACURA/CL/200165/1970";
  expect(transformScottsRecord(older, scottsContext).status).toBe("available");
});

test("Scotts deduplicates normalized VINs and keeps optional metadata nullable", () => {
  const first = nativeRecord();
  first[5] = "200165/200165_1.jpg";
  const second = nativeRecord();
  second[0] = second[0].toLowerCase();
  second[3] = "";
  second[5] = "200165/200165_2.jpg";
  const snapshot = scottsSnapshot(makes, [scottsPage([first, second])]);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 2,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 1,
  });
  expect(snapshot.vehicles).toHaveLength(1);
  expect(snapshot.vehicles[0]).toMatchObject({
    vin: first[0],
    stockNumber: "200165",
    imageUrl: null,
  });
});

test("Scotts enforces complete graph, accounting, inventory floor and existing quality ratios", () => {
  const rows = Array.from({ length: 800 }, (_, index): ScottsRecord => {
    const row = nativeRecord();
    row[0] = "1HGCM82633A" + String(index).padStart(6, "0");
    row[3] = "TEST" + index;
    row[6] = row[3];
    row[4] = "/used-parts/ACURA/CL/" + row[6] + "/1997";
    return row;
  });
  const snapshot = scottsSnapshot(makes, [scottsPage(rows)]);
  expect(() => validateScottsSnapshot(snapshot)).not.toThrow();
  expect(() => scottsSnapshot(makes, [])).toThrow("missing");
  expect(() =>
    validateScottsSnapshot({
      ...snapshot,
      vehicles: snapshot.vehicles.slice(1),
    }),
  ).toThrow("800");
  expect(() =>
    validateScottsSnapshot({
      ...snapshot,
      accounting: {
        ...snapshot.accounting,
        recordsProcessed: 900,
        recordsRejected: 100,
      },
    }),
  ).toThrow("10%");
  expect(() =>
    validateScottsSnapshot({
      ...snapshot,
      accounting: {
        ...snapshot.accounting,
        recordsProcessed: 1100,
        duplicateVehicles: 300,
      },
    }),
  ).toThrow("25%");
});
