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
      [1976, 1],
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

const rejection = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
};

test("lag the same searches confirm as stale passes at exactly 50% and is a transient rejection above it", () => {
  // A distribution frozen for days: departures and arrivals both diverge.
  const coverage = VinplusCoverage.fromCounts(
    "Example yard",
    split,
    new Map([
      [2006, 0],
      [2007, 5001],
    ]),
    new Set([2006, 2007]),
  );
  expect(coverage.lagging).toBe(5000);
  expect(coverage.warnings.join(" ")).toContain(
    "Example yard: 5000 advertised vehicles / 10000 (50.000000%) are absent from complete live searches (2006: 5000). The same searches found 1 vehicles the distribution does not count yet, so it is stale; within the 50% lag limit",
  );
  const above = rejection(() =>
    VinplusCoverage.fromCounts(
      "Example yard",
      split,
      new Map([
        [2006, 0],
        [2007, 4999],
        [1976, 1],
      ]),
      new Set([2006, 2007]),
    ),
  );
  expect(above instanceof Error ? above.message : "").toContain(
    "This exceeds the 50% lag limit",
  );
  expect(validationRejectionKind(above)).toBe("transient");
});

test("lag the distribution has not confirmed passes at exactly 1% and is a transient rejection above it", () => {
  const exact = VinplusCoverage.fromCounts(
    "Example yard",
    advertised,
    new Map([[2006, 9900]]),
    new Set([2006]),
  );
  expect(exact.lagging).toBe(100);
  expect(exact.warnings.join(" ")).toContain(
    "No searchable vehicle exceeds the distribution, so nothing shows it is stale and the searches may have silently returned fewer rows; within the 1% lag limit",
  );
  const above = rejection(() =>
    VinplusCoverage.fromCounts(
      "Example yard",
      advertised,
      new Map([[2006, 9899]]),
      new Set([2006]),
    ),
  );
  expect(above instanceof Error ? above.message : "").toContain(
    "101 advertised vehicles / 10000 (1.010000%) are absent from complete live searches (2006: 101). No searchable vehicle exceeds the distribution",
  );
  expect(above instanceof Error ? above.message : "").toContain(
    "VinPlus is not published this attempt and every VinPlus yard keeps its published inventory",
  );
  // A refreshed distribution clears it, so the source retries the same day.
  expect(validationRejectionKind(above)).toBe("transient");
});

test("unreachable rows stay a deterministic rejection when lag also exceeds its limit", () => {
  const both = rejection(() =>
    VinplusCoverage.fromCounts(
      "Example yard",
      split,
      new Map([
        [2006, 4899],
        [2007, 4899],
      ]),
      new Set([2007]),
    ),
  );
  const message = both instanceof Error ? both.message : "";
  expect(message).toContain("101 unreachable advertised vehicles / 10000");
  expect(message).toContain(
    "Lag also exceeds its 1% limit: Example yard: 101 advertised vehicles",
  );
  expect(validationRejectionKind(both)).not.toBe("transient");
});
