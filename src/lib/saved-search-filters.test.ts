import { test, expect } from "bun:test";
import { filtersSchema } from "./saved-search-filters";

test("rejects ambiguous VIN plus expression criteria", () => {
  expect(
    filtersSchema.safeParse({
      expression: "make:Honda",
      vinPattern: "1HGCM82633A004352",
    }).success,
  ).toBe(false);
});
