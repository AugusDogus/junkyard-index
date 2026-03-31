import { describe, expect, test } from "bun:test";
import { filtersSchema } from "~/lib/saved-search-filters";

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
    const tooOld = filtersSchema.safeParse({ minYear: 1800 });
    const tooNew = filtersSchema.safeParse({
      maxYear: new Date().getUTCFullYear() + 2,
    });

    expect(tooOld.success).toBe(false);
    expect(tooNew.success).toBe(false);
  });

  test("accepts valid integer years and known sources", () => {
    const nextYear = new Date().getUTCFullYear() + 1;
    const result = filtersSchema.safeParse({
      minYear: 2012,
      maxYear: nextYear,
      sources: ["pyp", "row52", "pullapart"],
    });

    expect(result.success).toBe(true);
  });
});
