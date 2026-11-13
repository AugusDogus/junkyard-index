import { expect, test } from "bun:test";
import { centralSnapshot, validateCentralSnapshot } from "./central-snapshot";
import {
  centralFixtureMake,
  centralFixtureModel,
  centralFixturePage,
  centralFixtureRecord,
} from "./central-test-fixtures";
const makes = [{ ...centralFixtureMake, models: [centralFixtureModel] }];

test("Central deduplicates case-only native VIN variants using the actual normalized helper", () => {
  const first = centralFixtureRecord(1);
  const lower = centralFixtureRecord(1);
  lower[0] = lower[0].toLowerCase();
  const snapshot = centralSnapshot(makes, [centralFixturePage([first, lower])]);
  expect(snapshot.vehicles).toHaveLength(1);
  expect(snapshot.accounting.recordsRejected).toBe(0);
  expect(snapshot.accounting.duplicateVehicles).toBe(1);
  expect(snapshot.observedVins).toEqual([]);
});
test("Central quarantines both destinations for one native VIN without choosing an order-dependent winner", () => {
  const first = centralFixtureRecord(1);
  const second = centralFixtureRecord(1);
  second[3] = "OTHER";
  second[4] = "/used-parts/ACURA/ILX/OTHER/2003";
  for (const rows of [
    [first, second],
    [second, first],
  ]) {
    const snapshot = centralSnapshot(makes, [centralFixturePage(rows)]);
    expect(snapshot.vehicles).toEqual([]);
    expect(snapshot.observedVins).toEqual([first[0]]);
    expect(snapshot.accounting).toEqual({
      recordsProcessed: 2,
      recordsExcluded: 0,
      recordsRejected: 2,
      duplicateVehicles: 0,
    });
  }
});
test("Central propagates required failures and shared-destination identity collisions to every VIN occurrence", () => {
  const first = centralFixtureRecord(1);
  const incomplete = centralFixtureRecord(1);
  incomplete[1] = "";
  const other = centralFixtureRecord(2);
  other[4] = first[4];
  const snapshot = centralSnapshot(makes, [
    centralFixturePage([first, incomplete, other]),
  ]);
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.accounting.recordsRejected).toBe(3);
  expect(snapshot.observedVins).toEqual([first[0], other[0]]);
});
test("Central optional disagreement remains nullable without rejecting required identity", () => {
  const first = centralFixtureRecord(1);
  first[5] = "ST1/ST1_1.jpg";
  const second = centralFixtureRecord(1);
  second[3] = "different";
  second[5] = "ST1/ST1_2.jpg";
  const snapshot = centralSnapshot(makes, [
    centralFixturePage([first, second]),
  ]);
  expect(snapshot.vehicles).toHaveLength(1);
  expect(snapshot.accounting.duplicateVehicles).toBe(1);
  expect(snapshot.vehicles[0]?.stockNumber).toBe("ST1");
});
test("Central enforces the 5000 donor floor and existing quality guards", () => {
  const records = Array.from({ length: 5000 }, (_, index) =>
    centralFixtureRecord(index + 1),
  );
  const snapshot = centralSnapshot(makes, [centralFixturePage(records)]);
  expect(() => validateCentralSnapshot(snapshot)).not.toThrow();
  expect(() =>
    validateCentralSnapshot({
      ...snapshot,
      vehicles: snapshot.vehicles.slice(1),
    }),
  ).toThrow("5000");
  expect(() =>
    validateCentralSnapshot({
      ...snapshot,
      accounting: {
        ...snapshot.accounting,
        recordsProcessed: 6000,
        recordsRejected: 1000,
      },
    }),
  ).toThrow("10%");
});
