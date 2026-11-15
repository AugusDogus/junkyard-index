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

test("year overcounts cannot offset unreachable vehicles in another year", () => {
  expect(() =>
    VinplusCoverage.fromCounts(
      "Example yard",
      {
        count: 10_000,
        years: [
          { year: 2006, count: 5000 },
          { year: 2007, count: 5000 },
        ],
      },
      new Map([
        [2006, 4999],
        [2007, 5001],
      ]),
    ),
  ).toThrow("exceeds its advertised year count");
});

test("unadvertised years fail and exact coverage has no warning", () => {
  expect(() =>
    VinplusCoverage.fromCounts(
      "Example yard",
      advertised,
      new Map([
        [2006, 10_000],
        [2007, 1],
      ]),
    ),
  ).toThrow("unadvertised year");
  expect(
    VinplusCoverage.fromCounts(
      "Example yard",
      advertised,
      new Map([[2006, 10_000]]),
    ),
  ).toEqual({ unreachable: 0, warnings: [] });
});
