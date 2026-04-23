import { describe, expect, test } from "bun:test";
import { filtersSchema } from "~/lib/saved-search-filters";
import {
  MAX_VEHICLE_YEAR,
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
    const tooOld = filtersSchema.safeParse({ minYear: MIN_VEHICLE_YEAR - 1 });
    const tooNew = filtersSchema.safeParse({ maxYear: MAX_VEHICLE_YEAR + 1 });

    expect(tooOld.success).toBe(false);
    expect(tooNew.success).toBe(false);
  });

  test("accepts valid integer years and known sources", () => {
    const result = filtersSchema.safeParse({
      minYear: 2012,
      maxYear: MAX_VEHICLE_YEAR,
      sources: ["pyp", "row52", "pullapart", "upullitne"],
    });

    expect(result.success).toBe(true);
  });

  test("accepts very old but still valid vehicle years", () => {
    const result = filtersSchema.safeParse({
      minYear: MIN_VEHICLE_YEAR,
      maxYear: 1908,
    });

    expect(result.success).toBe(true);
  });
});
