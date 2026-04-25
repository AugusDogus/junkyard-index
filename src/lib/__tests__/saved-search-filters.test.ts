import { describe, expect, test } from "bun:test";
import { filtersSchema } from "~/lib/saved-search-filters";
import {
  getMaxVehicleYear,
  MIN_VEHICLE_YEAR,
} from "~/lib/search-filter-bounds";

describe("saved search filters schema", () => {
  test("rejects invalid data sources", () => {
    const result = filtersSchema.safeParse({
      sources: ["pyp", "invalid-source"],
    });

    expect(result.success).toBe(false);
  });

  test("rejects non-integer years", () => {
    const minYearResult = filtersSchema.safeParse({ minYear: 2017.5 });
    const maxYearResult = filtersSchema.safeParse({ maxYear: 2020.25 });

    expect(minYearResult.success).toBe(false);
    expect(maxYearResult.success).toBe(false);
  });

  test("rejects years outside supported bounds", () => {
    const maxVehicleYear = getMaxVehicleYear();
    const tooOld = filtersSchema.safeParse({ minYear: MIN_VEHICLE_YEAR - 1 });
    const tooNew = filtersSchema.safeParse({ maxYear: maxVehicleYear + 1 });

    expect(tooOld.success).toBe(false);
    expect(tooNew.success).toBe(false);
  });

  test("accepts valid integer years and known sources", () => {
    const maxVehicleYear = getMaxVehicleYear();
    const result = filtersSchema.safeParse({
      minYear: 2012,
      maxYear: maxVehicleYear,
      sources: ["pyp", "row52", "pullapart", "upullitne"],
    });

    expect(result.success).toBe(true);
  });

  test("accepts very old but still valid vehicle years", () => {
    const historicalResult = filtersSchema.safeParse({
      minYear: MIN_VEHICLE_YEAR,
      maxYear: MIN_VEHICLE_YEAR + 22,
    });
    const currentMaxYearResult = filtersSchema.safeParse({
      minYear: getMaxVehicleYear() - 5,
      maxYear: getMaxVehicleYear(),
    });

    expect(historicalResult.success).toBe(true);
    expect(currentMaxYearResult.success).toBe(true);
  });
});
