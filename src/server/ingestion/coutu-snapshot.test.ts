import { expect, test } from "bun:test";
import { coutuHash, type CoutuRecord } from "./coutu-parser";
import { coutuSnapshot, validateCoutuSnapshot } from "./coutu-snapshot";
import { coutuVin, transformCoutuRecord } from "./coutu-transform";
import { coutuFixtureRecord } from "./coutu-test-fixtures";

const snapshot = (records: CoutuRecord[]) =>
  coutuSnapshot([{ records, hash: coutuHash(records) }]);
test("Coutu uses the actual historical serial rule and preserves make-equals-model", () => {
  const record = coutuFixtureRecord(1);
  record[0] = "383208H879516";
  record[1] = record[2] = "1969";
  record[3] = record[4] = record[5] = record[6] = "INTERNATIONAL";
  const result = transformCoutuRecord(record);
  expect(result.status).toBe("available");
  if (result.status !== "available")
    throw new Error("Expected native International donor");
  expect(result.vehicle).toMatchObject({
    vin: "383208H879516",
    year: 1969,
    make: "International",
    model: "INTERNATIONAL",
  });
  record[1] = record[2] = "1981";
  expect(transformCoutuRecord(record)).toEqual({
    status: "incomplete",
    vin: null,
  });
});

test("Coutu quarantines every occurrence of conflicting native year, make or model", () => {
  for (const index of [1, 2, 3, 4, 5, 6] as const) {
    const record = coutuFixtureRecord(1);
    const changed: CoutuRecord = [...record];
    changed[index] = index < 3 ? "2001" : "DIFFERENT";
    const result = snapshot([record, changed]);
    expect(result.vehicles).toHaveLength(0);
    expect(result.observedVins).toEqual([record[0]]);
    expect(result.accounting).toEqual({
      recordsProcessed: 2,
      recordsExcluded: 0,
      recordsRejected: 2,
      duplicateVehicles: 0,
    });
  }
});

test("Coutu quarantines both same-VIN destinations and cross-VIN destination collisions", () => {
  const record = coutuFixtureRecord(1);
  const variant: CoutuRecord = [...record];
  variant[8] = "https://www.truckcountry.us/browse/vehicle/different";
  const sameIdentity = snapshot([record, variant]);
  expect(sameIdentity.vehicles).toHaveLength(0);
  expect(sameIdentity.accounting.recordsRejected).toBe(2);
  const second = coutuFixtureRecord(2);
  second[8] = record[8];
  const sameDestination = snapshot([record, second]);
  expect(sameDestination.vehicles).toHaveLength(0);
  expect(sameDestination.observedVins.sort()).toEqual(
    [record[0], second[0]].sort(),
  );
  expect(sameDestination.accounting.recordsRejected).toBe(2);
});

test("Coutu optional disagreements become null without required rejection", () => {
  const record = coutuFixtureRecord(1);
  record[9] = "https://truckcountry.s3.amazonaws.com/vehicle/one.jpg";
  const variant: CoutuRecord = [...record];
  variant[7] = "ST2";
  variant[9] = "https://truckcountry.s3.amazonaws.com/vehicle/two.jpg";
  const result = snapshot([record, variant]);
  expect(result.vehicles).toHaveLength(1);
  expect(result.vehicles[0]).toMatchObject({
    stockNumber: null,
    imageUrl: null,
    availableDate: null,
  });
  expect(result.accounting.duplicateVehicles).toBe(1);
  expect(result.accounting.recordsRejected).toBe(0);
});

test("Coutu rejects unsafe required destinations while retaining valid VIN presence", () => {
  const record = coutuFixtureRecord(1);
  record[8] = "https://example.com/donor/1";
  expect(snapshot([record]).observedVins).toEqual([record[0]]);
  record[0] = "383208H879516";
  record[1] = "unknown";
  record[2] = "1969";
  expect(coutuVin(record)).toBe("383208H879516");
  expect(snapshot([record]).observedVins).toEqual([record[0]]);
});

test("Coutu enforces the 1000 donor floor and original source quality guards", () => {
  const rows = Array.from({ length: 1000 }, (_, i) =>
    coutuFixtureRecord(i + 1),
  );
  expect(() => validateCoutuSnapshot(snapshot(rows))).not.toThrow();
  expect(() => validateCoutuSnapshot(snapshot(rows.slice(1)))).toThrow(
    "below 1000",
  );
  const invalid = Array.from({ length: 112 }, () => {
    const r = coutuFixtureRecord(2000);
    r[0] = "";
    return r;
  });
  expect(() => validateCoutuSnapshot(snapshot([...rows, ...invalid]))).toThrow(
    "rejection exceeds 10%",
  );
  expect(() =>
    validateCoutuSnapshot(snapshot([...rows, ...rows.slice(0, 334)])),
  ).toThrow("duplicates exceed 25%");
});
