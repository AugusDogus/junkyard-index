import { expect, test } from "bun:test";
import { byotSnapshot } from "./byot-snapshot";
import { byotFeeds, byotMissingF150 } from "./byot-test-fixtures";

test("repeated invalid observations stay rejects and cannot dilute the 10% guard", () => {
  const invalid = Array.from({ length: 480 }, (_, index) => ({
    ...byotMissingF150,
    StockId: `STK900${index}`,
    VIN: "NA",
  }));
  const snapshot = byotSnapshot(
    [[...(byotFeeds[0] ?? []), ...invalid, ...invalid], ...byotFeeds.slice(1)],
    [[], [], [], [], []],
  );
  expect(snapshot.accounting.recordsRejected).toBe(976);
  expect(snapshot.validation.ok).toBe(false);
});
test("all observations of a conflicting VIN remain rejected, including same-response repeats", () => {
  const first = { ...byotMissingF150, StockId: "STK999991" };
  const conflict = { ...byotMissingF150, StockId: "STK999992", Year: 2004 };
  const snapshot = byotSnapshot(
    [[...(byotFeeds[0] ?? []), first, first, conflict], ...byotFeeds.slice(1)],
    [[], [], [], [], []],
  );
  expect(snapshot.accounting.recordsRejected).toBe(19);
  expect(
    snapshot.vehicles.some((vehicle) => vehicle.vin === byotMissingF150.VIN),
  ).toBe(false);
});
