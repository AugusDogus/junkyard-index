import { describe, expect, test } from "bun:test";
import {
  MAX_VEHICLE_YEAR,
  mergeSelectedFilterOptions,
  MIN_VEHICLE_YEAR,
  normalizeVehicleYearFilter,
} from "~/lib/search-filter-bounds";

describe("search filter bounds", () => {
  test("normalizes empty year filters to the full supported range", () => {
    const result = normalizeVehicleYearFilter(undefined, undefined);

    expect(result.range).toEqual([MIN_VEHICLE_YEAR, MAX_VEHICLE_YEAR]);
    expect(result.minYear).toBeUndefined();
    expect(result.maxYear).toBeUndefined();
    expect(result.isFiltered).toBe(false);
  });

  test("clamps and sorts inverted year filters", () => {
    const result = normalizeVehicleYearFilter(
      MAX_VEHICLE_YEAR + 10,
      MIN_VEHICLE_YEAR - 10,
    );

    expect(result.range).toEqual([MIN_VEHICLE_YEAR, MAX_VEHICLE_YEAR]);
    expect(result.minYear).toBeUndefined();
    expect(result.maxYear).toBeUndefined();
    expect(result.isFiltered).toBe(false);
  });

  test("keeps partial year filters when only one side is set", () => {
    const result = normalizeVehicleYearFilter(2027, undefined);

    expect(result.range).toEqual([2027, MAX_VEHICLE_YEAR]);
    expect(result.minYear).toBe(2027);
    expect(result.maxYear).toBeUndefined();
    expect(result.isFiltered).toBe(true);
  });

  test("merges selected filter values back into available options", () => {
    const result = mergeSelectedFilterOptions(
      ["Acura", "Toyota"],
      ["Honda", "Toyota"],
    );

    expect(result).toEqual(["Acura", "Honda", "Toyota"]);
  });
});
