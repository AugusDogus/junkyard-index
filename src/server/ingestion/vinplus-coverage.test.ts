import { expect, test } from "bun:test";
import { validationRejectionKind } from "./ingestion-validation";
import { VinplusCoverage } from "./vinplus-coverage";

const advertised = { count: 10_000, years: [{ year: 2006, count: 10_000 }] };

test("exactly 1% unreachable advertised vehicles qualifies with a count warning", () => {
  const coverage = VinplusCoverage.fromCounts(
    "Example yard",
    advertised,
    new Map([[2006, 9900]]),
    new Set(),
  );
  expect(coverage.unreachable).toBe(100);
  expect(coverage.warnings.join(" ")).toContain(
    "100 unreachable advertised vehicles / 10000",
  );
  expect(coverage.warnings.join(" ")).toContain("2006: 100");
});

test("just above 1% fails for the individual yard", () => {
  expect(() =>
    VinplusCoverage.fromCounts(
      "Small yard",
      advertised,
      new Map([[2006, 9899]]),
      new Set(),
    ),
  ).toThrow("exceeds the 1% limit");
});

const split = {
  count: 10_000,
  years: [
    { year: 2006, count: 5000 },
    { year: 2007, count: 5000 },
  ],
};

test("year overcounts cannot offset unreachable vehicles in another year", () => {
  const coverage = VinplusCoverage.fromCounts(
    "Example yard",
    split,
    new Map([
      [2006, 4999],
      [2007, 5001],
    ]),
    new Set(),
  );
  expect(coverage.unreachable).toBe(1);
  expect(coverage.warnings.join(" ")).toContain("year deficits: 2006: 1");
  expect(coverage.warnings.join(" ")).toContain(
    "2007: 5001 of 5000 advertised",
  );
  expect(() =>
    VinplusCoverage.fromCounts(
      "Example yard",
      split,
      new Map([
        [2006, 4899],
        [2007, 5101],
      ]),
      new Set(),
    ),
  ).toThrow("101 unreachable advertised vehicles / 10000");
});

test("searchable vehicles beyond a lagging distribution are reported and exact coverage has no warning", () => {
  expect(
    VinplusCoverage.fromCounts(
      "Example yard",
      advertised,
      new Map([
        [2006, 10_000],
        [1976, 1],
      ]),
      new Set(),
    ),
  ).toEqual({
    unreachable: 0,
    lagging: 0,
    warnings: [
      "Example yard: 1 searchable vehicles exceed the lagging year distribution (1976: 1 of 0 advertised); they are kept and do not offset deficits.",
    ],
  });
  expect(
    VinplusCoverage.fromCounts(
      "Example yard",
      advertised,
      new Map([[2006, 10_000]]),
      new Set(),
    ),
  ).toEqual({ unreachable: 0, lagging: 0, warnings: [] });
});

test("deficits in years a complete live search answered are distribution lag, not unreachable", () => {
  const coverage = VinplusCoverage.fromCounts(
    "Example yard",
    split,
    new Map([
      [2006, 4800],
      [2007, 4999],
    ]),
    new Set([2006]),
  );
  expect(coverage.unreachable).toBe(1);
  expect(coverage.lagging).toBe(200);
  expect(coverage.warnings.join(" ")).toContain(
    "Example yard: 200 advertised vehicles / 10000 (2.000000%) are absent from complete live searches (2006: 200)",
  );
  expect(coverage.warnings.join(" ")).toContain(
    "1 unreachable advertised vehicles / 10000",
  );
});

test("distribution lag passes at exactly 10% and fails above it", () => {
  expect(
    VinplusCoverage.fromCounts(
      "Example yard",
      advertised,
      new Map([[2006, 9000]]),
      new Set([2006]),
    ).lagging,
  ).toBe(1000);
  expect(() =>
    VinplusCoverage.fromCounts(
      "Example yard",
      advertised,
      new Map([[2006, 8999]]),
      new Set([2006]),
    ),
  ).toThrow("exceeds the 10% lag limit");
  const stale = (() => {
    try {
      VinplusCoverage.fromCounts(
        "Example yard",
        advertised,
        new Map([[2006, 8999]]),
        new Set([2006]),
      );
    } catch (error) {
      return error;
    }
    return null;
  })();
  // A refreshed distribution clears it, so the source retries the same day.
  expect(validationRejectionKind(stale)).toBe("transient");
});
