import { expect, test } from "bun:test";
import {
  inspectWeberbrothersSnapshot as inspect,
  validateWeberbrothersSnapshot as validate,
} from "./weberbrothers-snapshot";
import {
  weberbrothersFixturePost as post,
  weberbrothersFixtureRecord as record,
} from "./weberbrothers-test-fixtures";

test("benign duplicate observations reconcile once and conflicting optional metadata becomes null", () => {
  const first = record(),
    second = record(
      {
        ...post,
        url: post.url.replace("/product/", "/product/second-"),
        nativePostId: "1908004",
      },
      { color: "White" },
    );
  const snapshot = inspect([first, second]);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 2,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 1,
  });
  expect(snapshot.vehicles).toHaveLength(1);
  expect(snapshot.vehicles[0]?.color).toBeNull();
});
test("conflicting native years quarantine all appearances, never choose the first row", () => {
  const snapshot = inspect([
    record(),
    record({
      ...post,
      title: "2024 NISSAN MURANO SV",
      nativePostId: "1908004",
    }),
  ]);
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.observedVins).toEqual(["5N1AZ3BS4SC111240"]);
  expect(snapshot.conflicts.length).toBeGreaterThan(0);
});
test("stock/VIN conflict quarantine propagates through connected duplicates", () => {
  const snapshot = inspect([
    record(),
    record({ ...post, nativePostId: "1908004" }, { vin: "JM3KKBHD6S1200827" }),
    record(
      { ...post, nativePostId: "1908005", stock: "OTHER" },
      { vin: "JM3KKBHD6S1200827" },
    ),
  ]);
  expect(snapshot.accounting.recordsRejected).toBe(3);
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.observedVins).toEqual([
    "5N1AZ3BS4SC111240",
    "JM3KKBHD6S1200827",
  ]);
});
test("source floors, rejection, duplicate and prior-run guards stay unchanged", () => {
  const clean = inspect([record()]);
  expect(
    validate(clean, { minimumUniqueInventory: 1, previousUniqueInventory: 2 }),
  ).toBe(clean);
  expect(() =>
    validate(clean, {
      minimumUniqueInventory: 2,
      previousUniqueInventory: null,
    }),
  ).toThrow("minimum");
  expect(() =>
    validate(clean, { minimumUniqueInventory: 1, previousUniqueInventory: 4 }),
  ).toThrow("50%");
  expect(() =>
    validate(
      inspect([
        record(),
        record(
          { ...post, title: "20225 NISSAN MURANO SV", stock: "OTHER" },
          { vin: "JM3KKBHD6S1200827" },
        ),
      ]),
      { minimumUniqueInventory: 1, previousUniqueInventory: null },
    ),
  ).toThrow("10%");
  expect(() =>
    validate(inspect([record(), record()]), {
      minimumUniqueInventory: 1,
      previousUniqueInventory: null,
    }),
  ).toThrow("25%");
});
