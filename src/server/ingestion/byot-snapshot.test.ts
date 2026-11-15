import { describe, expect, test } from "bun:test";
import { byotSnapshot } from "./byot-snapshot";
import { BYOT_YARDS } from "./byot-configuration";
import { byotFeeds, byotMissingF150 } from "./byot-test-fixtures";
const empty = () => BYOT_YARDS.map(() => []);
const now = Date.UTC(2026, 10, 15);
describe("BYOT arrivals and weekly search union", () => {
  test("validates all five feeds and adds unphotographed search inventory without counting corroboration as duplicates", () => {
    const cache = empty();
    const snapshot = byotSnapshot(byotFeeds, cache);
    expect(snapshot.validation.ok).toBe(true);
    const union = byotSnapshot(byotFeeds, [
      [
        {
          index: 0,
          checkedAt: now,
          records: [byotMissingF150, ...(byotFeeds[0]?.slice(0, 20) ?? [])],
        },
      ],
      [],
      [],
      [],
      [],
    ]);
    expect(union.validation.ok).toBe(true);
    expect(
      union.vehicles.some((vehicle) => vehicle.stockNumber === "STK044158"),
    ).toBe(true);
    expect(union.vehicles.length).toBe(snapshot.vehicles.length + 1);
    expect(union.accounting.duplicateVehicles).toBe(
      snapshot.accounting.duplicateVehicles,
    );
  });
  test("quarantines native stock conflicts before optional merging or canonical normalization", () => {
    const snapshot = byotSnapshot(byotFeeds, [
      [
        {
          index: 0,
          checkedAt: now,
          records: [byotMissingF150, { ...byotMissingF150, Year: 2004 }],
        },
      ],
      [],
      [],
      [],
      [],
    ]);
    expect(
      snapshot.vehicles.some((vehicle) => vehicle.stockNumber === "STK044158"),
    ).toBe(false);
    expect(snapshot.observedVins).toContain(byotMissingF150.VIN);
    expect(snapshot.accounting.recordsRejected).toBeGreaterThan(0);
  });
  test("fails closed on per-yard floors, per-yard previous count drift, excessive rejections and same-response duplicates", () => {
    expect(
      byotSnapshot([[], ...byotFeeds.slice(1)], empty()).validation.ok,
    ).toBe(false);
    expect(
      byotSnapshot(byotFeeds, empty(), [10000, 0, 0, 0, 0]).validation.ok,
    ).toBe(false);
    const invalid = Array.from({ length: 1000 }, (_, i) => ({
      ...byotMissingF150,
      StockId: `STK999${i}`,
      VIN: "NA",
    }));
    expect(
      byotSnapshot(
        [[...(byotFeeds[0] ?? []), ...invalid], ...byotFeeds.slice(1)],
        empty(),
      ).validation.ok,
    ).toBe(false);
    const duplicates = Array.from({ length: 3000 }, () => byotMissingF150);
    expect(
      byotSnapshot(
        [[...(byotFeeds[0] ?? []), ...duplicates], ...byotFeeds.slice(1)],
        empty(),
      ).validation.ok,
    ).toBe(false);
  });
});

test("an explicitly empty refreshed bucket retires search-only inventory while feed evidence still keeps a donor", () => {
  const present = byotSnapshot(byotFeeds, [
    [{ index: 0, checkedAt: now, records: [byotMissingF150] }],
    [],
    [],
    [],
    [],
  ]);
  const refreshed = byotSnapshot(byotFeeds, [
    [{ index: 0, checkedAt: now + 86400000, records: [] }],
    [],
    [],
    [],
    [],
  ]);
  expect(
    present.vehicles.some((vehicle) => vehicle.stockNumber === "STK044158"),
  ).toBe(true);
  expect(
    refreshed.vehicles.some((vehicle) => vehicle.stockNumber === "STK044158"),
  ).toBe(false);
  const stillInFeed = byotSnapshot(
    [[...(byotFeeds[0] ?? []), byotMissingF150], ...byotFeeds.slice(1)],
    [[{ index: 0, checkedAt: now + 86400000, records: [] }], [], [], [], []],
  );
  expect(
    stillInFeed.vehicles.some((vehicle) => vehicle.stockNumber === "STK044158"),
  ).toBe(true);
});
