import { describe, expect, test } from "bun:test";
import { getSearchCapabilityPollInterval } from "../search-capability-polling";

describe("search capability polling", () => {
  test("backs off and stops after six unsuccessful checks", () => {
    expect(
      Array.from({ length: 7 }, (_, attempts) =>
        getSearchCapabilityPollInterval(false, attempts),
      ),
    ).toEqual([5_000, 5_000, 10_000, 20_000, 40_000, 60_000, false]);
  });

  test("stops as soon as readiness is confirmed", () => {
    expect(getSearchCapabilityPollInterval(true, 1)).toBe(false);
  });
});
