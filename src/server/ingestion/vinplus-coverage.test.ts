import { expect, test } from "bun:test";
import { VinplusCoverage } from "./vinplus-coverage";

const advertised = { count: 10_000, years: [{ year: 2006, count: 10_000 }] };

test("exactly 1% unreachable advertised vehicles qualifies with a count warning", () => {
  const coverage = VinplusCoverage.fromCounts(
    "Example yard",
    advertised,
    new Map([[2006, 9900]]),
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
    ),
  ).toEqual({
    unreachable: 0,
    warnings: [
      "Example yard: 1 searchable vehicles exceed the lagging year distribution (1976: 1 of 0 advertised); they are kept and do not offset deficits.",
    ],
  });
  expect(
    VinplusCoverage.fromCounts(
      "Example yard",
      advertised,
      new Map([[2006, 10_000]]),
    ),
  ).toEqual({ unreachable: 0, warnings: [] });
});
