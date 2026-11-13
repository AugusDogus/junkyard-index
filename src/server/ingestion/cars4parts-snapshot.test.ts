import { describe, expect, test } from "bun:test";
import { parseCars4PartsInventory } from "./cars4parts-parser";
import {
  cars4partsSnapshot,
  validateCars4PartsSnapshot,
} from "./cars4parts-snapshot";
import {
  cars4partsFixture,
  cars4partsTestContract,
  cars4partsTestPage,
  cars4partsTestRecord,
} from "./cars4parts-test-fixtures";

const native = parseCars4PartsInventory(cars4partsFixture("inventory"));
if (!native.ok) throw new Error(native.error.message);
const makes = native.value.makes;
const mazda = cars4partsTestRecord("mazda3"),
  quest = cars4partsTestRecord("quest");
const previous = { heyworth: null, armington: null };
const snapshot = (records: Parameters<typeof cars4partsTestPage>[0]) =>
  cars4partsSnapshot(
    [cars4partsTestPage(records)],
    records,
    makes,
    cars4partsTestContract,
  );

describe("Cars4Parts complete snapshot", () => {
  test("allocates native branch metadata and keeps inventory date and position absent", () => {
    const value = snapshot([mazda, quest]);
    expect(value.acceptedByYard).toEqual({ heyworth: 1, armington: 1 });
    expect(value.vehicles[1]).toMatchObject({
      locationCode: "armington",
      locationCity: "Armington",
      availableDate: null,
      row: null,
      section: null,
      space: null,
    });
    expect(
      validateCars4PartsSnapshot(value, cars4partsTestContract, previous).ok,
    ).toBe(true);
  });
  test("retains unresolved scope as a rejection and excludes explicit whole-vehicle retail", () => {
    const w = cars4partsTestRecord("w-series"),
      retail = cars4partsTestRecord("retail-tow");
    const value = snapshot([mazda, quest, w, retail]);
    expect(value.accounting).toEqual({
      recordsProcessed: 4,
      recordsRejected: 1,
      recordsExcluded: 1,
      duplicateVehicles: 0,
    });
    expect(value.assessments[2]?.reasons).toEqual([
      "unresolved-native-listing-role",
    ]);
    expect(value.observedVins).toEqual(["3B7HM13Y8LM027494"]);
    expect(value.rejectedIndices).toEqual([2]);
  });
  test("quarantines a connected conflicting VIN group and preserves every valid claim", () => {
    const conflicting = { ...quest, vins: [...quest.vins, ...mazda.vins] };
    const value = snapshot([mazda, conflicting]);
    expect(value.vehicles).toEqual([]);
    expect(value.accounting.recordsRejected).toBe(2);
    expect(value.observedVins).toEqual([
      "JM1BK143451282478",
      "JN8AE2KP8D9061436",
    ]);
    expect(value.quarantinedIndices).toEqual([0, 1]);
  });
  test("counts repeated native observations once per row and nulls conflicting optional metadata", () => {
    const page = cars4partsTestPage([mazda, mazda, quest]);
    const row = page.rows[1];
    if (!row) throw new Error("Test row missing");
    row.stock = "OTHER-STOCK";
    const value = cars4partsSnapshot(
      [page],
      [mazda, quest],
      makes,
      cars4partsTestContract,
    );
    expect(value.accounting.duplicateVehicles).toBe(1);
    expect(value.vehicles).toHaveLength(2);
    expect(value.vehicles[0]?.stockNumber).toBeNull();
    const validation = validateCars4PartsSnapshot(
      value,
      cars4partsTestContract,
      previous,
    );
    expect(validation.ok).toBe(false);
    if (!validation.ok)
      expect(validation.error.message).toContain(
        "heyworth benign duplicates exceed 25%",
      );
  });
  test("applies per-yard minimum, rejection and previous-run drift guards", () => {
    const value = snapshot([mazda, quest, cars4partsTestRecord("aspen")]);
    const guarded = {
      ...cars4partsTestContract,
      armington: {
        ...cars4partsTestContract.armington,
        minimumUniqueInventory: 2,
      },
    };
    const result = validateCars4PartsSnapshot(value, guarded, {
      heyworth: 3,
      armington: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain(
        "heyworth required rejection exceeds 10%",
      );
      expect(result.error.message).toContain(
        "heyworth accepted inventory fell below 50%",
      );
      expect(result.error.message).toContain(
        "armington accepted 1 is below root-supplied minimum 2",
      );
    }
  });
});
