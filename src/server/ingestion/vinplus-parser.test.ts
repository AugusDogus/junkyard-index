import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { VINPLUS_TENANTS } from "./vinplus-configuration";
import { inspectVinplusEvidence, vinplusScope } from "./vinplus-parser";
import {
  parseVinplusAnalytics,
  parseVinplusYearSearch,
} from "./vinplus-protocol";
import { vinplusSnapshot } from "./vinplus-snapshot";
import { validationRejectionKind } from "./ingestion-validation";
import { vinplusPublicDate } from "./vinplus-public-enrichment";

import {
  vinplusCensus,
  vinplusQualification,
  vinplusUsAutoSupplyLive,
} from "./vinplus-test-fixtures";
// The frozen census was captured through 2026-11-13.
const asOf = Date.parse("2026-11-14T12:00:00Z");
const first = () => {
  const tenant = VINPLUS_TENANTS[0];
  if (!tenant) throw new Error("Missing Pocatello configuration");
  return tenant;
};
test.each([
  {
    index: 0,
    accepted: 710,
    processed: 720,
    rejected: 10,
    observed: 3,
    serials: 3,
  },
  {
    index: 1,
    accepted: 1406,
    processed: 1423,
    rejected: 17,
    observed: 0,
    serials: 21,
  },
  {
    index: 2,
    accepted: 1082,
    processed: 1084,
    rejected: 2,
    observed: 1,
    serials: 5,
  },
  {
    index: 3,
    accepted: 464,
    processed: 490,
    rejected: 26,
    observed: 15,
    serials: 0,
  },
  {
    index: 4,
    accepted: 1558,
    processed: 1575,
    rejected: 17,
    observed: 14,
    serials: 2,
  },
  {
    index: 5,
    accepted: 1085,
    processed: 1097,
    rejected: 12,
    observed: 10,
    serials: 7,
  },
  {
    index: 6,
    accepted: 1316,
    processed: 1333,
    rejected: 17,
    observed: 5,
    serials: 1,
  },
])(
  "complete frozen yard census: tenant=$index",
  ({ index, accepted, processed, rejected, observed, serials }) => {
    const tenant = VINPLUS_TENANTS[index];
    const bodies = vinplusCensus()[index];
    if (!tenant || !bodies)
      throw new Error("Missing qualified tenant evidence");
    const result = inspectVinplusEvidence(tenant, bodies);
    if (result.kind !== "complete") throw new Error("Incomplete yard census");
    const snapshot = vinplusSnapshot(tenant, result.records, asOf);
    expect(snapshot.vehicles).toHaveLength(accepted);
    expect(snapshot.observedVins).toHaveLength(observed);
    expect(
      snapshot.vehicles.filter((vehicle) => vehicle.vin.length !== 17),
    ).toHaveLength(serials);
    expect(snapshot.accounting).toEqual({
      recordsProcessed: processed,
      recordsRejected: rejected,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
  },
);

test("Killeen qualifies with six unreachable rows reported after closing replay", () => {
  const tenant = VINPLUS_TENANTS[4];
  const opening = z
    .object({ killeen: z.object({ bodies: z.array(z.string()) }) })
    .parse(vinplusQualification()).killeen.bodies;
  if (!tenant) throw new Error("Missing Killeen");
  expect(inspectVinplusEvidence(tenant, opening).kind).toBe("pending");
  const result = inspectVinplusEvidence(tenant, vinplusCensus()[4] ?? []);
  if (result.kind !== "complete") throw new Error("Missing closing replay");
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings.join(" ")).toContain(
    "6 unreachable advertised vehicles / 1581 (0.379507%)",
  );
  expect(result.warnings.join(" ")).toContain("2006: 4, 2007: 1, 2008: 1");
});

test("Killeen fails its own 1% limit even when the other yards are complete", () => {
  const tenant = VINPLUS_TENANTS[4];
  if (!tenant) throw new Error("Missing Killeen");
  const evidence = [
    ...z
      .object({ killeen: z.object({ bodies: z.array(z.string()) }) })
      .parse(vinplusQualification()).killeen.bodies,
  ];
  const counts = z
    .object({
      success: z.literal(true),
      data: z.object({
        current_count: z.number(),
        by_year: z.array(z.object({ year: z.string(), count: z.number() })),
      }),
    })
    .parse(JSON.parse(evidence[2] ?? ""));
  const year = counts.data.by_year.find((row) => row.year === "2006");
  if (!year) throw new Error("Missing unresolved year");
  year.count += 10;
  counts.data.current_count += 10;
  evidence[2] = JSON.stringify(counts);
  expect(() => inspectVinplusEvidence(tenant, evidence)).toThrow(
    "16 unreachable advertised vehicles / 1591",
  );
});

describe("frozen public VinPlus protocol", () => {
  test("enumerates Pocatello including public inventory behind hidden search", () => {
    const result = inspectVinplusEvidence(first(), vinplusCensus()[0] ?? []);
    expect(result.kind).toBe("complete");
    if (result.kind !== "complete")
      throw new Error("Pending terminal evidence");
    const snapshot = vinplusSnapshot(first(), result.records, asOf);
    expect(snapshot.vehicles).toHaveLength(710);
    expect(snapshot.accounting).toEqual({
      recordsProcessed: 720,
      recordsRejected: 10,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
    expect(
      snapshot.vehicles.every(
        (vehicle) =>
          vehicle.locationCode === "pocatello" && vehicle.stateAbbr === "ID",
      ),
    ).toBe(true);
  });
  test("reports rows a complete uncapped search omits as distribution lag, never as donors", () => {
    const evidence = [...(vinplusCensus()[0] ?? [])];
    const closingIndex = 3 + (evidence.length - 6) / 2;
    const page = z
      .object({ matches: z.array(z.unknown()), match_count: z.number() })
      .passthrough()
      .parse(JSON.parse(evidence[3] ?? ""));
    page.matches.splice(-7);
    page.match_count -= 7;
    evidence[3] = evidence[closingIndex] = JSON.stringify(page);
    const result = inspectVinplusEvidence(first(), evidence);
    if (result.kind !== "complete") throw new Error("Pending evidence");
    expect(result.records).toHaveLength(713);
    expect(result.warnings.join(" ")).toContain(
      "7 advertised vehicles / 720 (0.972222%) are absent from complete live searches",
    );
  });
  test("rejects wrong tenant, stock repeats, out-of-range years and unknown fields", () => {
    const body = vinplusCensus()[0]?.[3];
    if (!body) throw new Error("Missing saved range");
    const page = z
      .object({
        matches: z.array(z.record(z.unknown())),
        search_criteria: z.object({
          year_min: z.number(),
          year_max: z.number(),
        }),
      })
      .passthrough()
      .parse(JSON.parse(body));
    const parse = (raw: string) =>
      parseVinplusYearSearch(
        raw,
        vinplusScope(first()),
        page.search_criteria.year_min,
        page.search_criteria.year_max,
      );
    expect(() =>
      parse(
        body
          .replace(
            '"yard_id":"u_pull_auto_parts_pocatello"',
            '"yard_id":"other"',
          )
          .replace(
            '"yard_id": "u_pull_auto_parts_pocatello"',
            '"yard_id": "other"',
          ),
      ),
    ).toThrow();
    for (const patch of [
      { yardLocation: "Another yard" },
      { year: 2100 },
      { unexpected: true },
    ]) {
      const matches = [...page.matches];
      matches[0] = { ...matches[0], ...patch };
      expect(() =>
        parse(JSON.stringify({ ...JSON.parse(body), matches })),
      ).toThrow();
    }
    const matches = [...page.matches];
    matches[1] = matches[0] ?? {};
    expect(() =>
      parse(JSON.stringify({ ...JSON.parse(body), matches })),
    ).toThrow("duplicate");
  });
  test("closing ignores only daysInYard and rejects complete-record drift", () => {
    const bodies = vinplusCensus()[0] ?? [];
    const closingIndex = 3 + (bodies.length - 6) / 2;
    for (const [field, value, accepted] of [
      ["daysInYard", 999, true],
      ["color", "PURPLE", false],
      ["vin", "1GCHK23U44F248109", false],
      ["model", "CHANGED", false],
    ] as const) {
      const evidence = [...bodies];
      const page = z
        .object({ matches: z.array(z.record(z.unknown())) })
        .passthrough()
        .parse(JSON.parse(evidence[closingIndex] ?? ""));
      page.matches[0] = { ...page.matches[0], [field]: value };
      evidence[closingIndex] = JSON.stringify(page);
      if (accepted)
        expect(inspectVinplusEvidence(first(), evidence).kind).toBe("complete");
      else
        expect(() => inspectVinplusEvidence(first(), evidence)).toThrow(
          "Closing inventory",
        );
    }
  });
  test("keeps a real offset timestamp verbatim and treats naive time as calendar only", () => {
    expect(vinplusPublicDate("2026-11-14T17:23:11.123456-06:00")?.value).toBe(
      "2026-11-14T17:23:11.123456-06:00",
    );
    expect(vinplusPublicDate("2026-11-14T17:23:11.123")?.value).toBe(
      "2026-11-14",
    );
    expect(vinplusPublicDate("2026-02-30T00:00:00-06:00")).toBeNull();
    expect(vinplusPublicDate("2026-11-14T00:00:00-00:00")).toBeNull();
  });
});

describe("US Auto Supply year distribution lagging live search", () => {
  const tenant = () => {
    const found = VINPLUS_TENANTS.find(
      (value) => value.yardId === "us_auto_supply",
    );
    if (!found) throw new Error("Missing US Auto Supply configuration");
    return found;
  };
  /** Keeps the live distribution's pre-2000 years, which the single saved
   * 1960-1999 control covers, then applies a stale-cache edit. */
  const evidence = (stale: (years: Map<string, number>) => void) => {
    const live = vinplusUsAutoSupplyLive();
    const [app, config] = vinplusCensus()[2] ?? [];
    if (!app || !config) throw new Error("Missing US Auto Supply app/config");
    const counts = z
      .object({
        success: z.literal(true),
        data: z.object({
          by_year: z.array(z.object({ year: z.string(), count: z.number() })),
        }),
      })
      .parse(JSON.parse(live.analytics));
    const years = new Map(
      counts.data.by_year
        .filter((row) => Number(row.year) < 2000)
        .map((row) => [row.year, row.count]),
    );
    stale(years);
    const by_year = [...years].map(([year, count]) => ({ year, count }));
    const analytics = JSON.stringify({
      success: true,
      data: {
        current_count: by_year.reduce((sum, row) => sum + row.count, 0),
        by_year,
      },
    });
    return [
      app,
      config,
      analytics,
      live.search,
      live.search,
      analytics,
      config,
      app,
    ];
  };

  test("live capture reconciles exactly with its own distribution", () => {
    const result = inspectVinplusEvidence(
      tenant(),
      evidence(() => undefined),
    );
    if (result.kind !== "complete") throw new Error("Pending evidence");
    expect(result.records).toHaveLength(81);
    expect(result.warnings).toEqual([]);
  });

  test("accepts a real 1976 vehicle the cached distribution does not list yet", () => {
    const result = inspectVinplusEvidence(
      tenant(),
      evidence((years) => years.delete("1976")),
    );
    if (result.kind !== "complete") throw new Error("Pending evidence");
    expect(
      result.records.filter((record) => record.year === 1976),
    ).toHaveLength(1);
    expect(result.records).toHaveLength(81);
    expect(result.warnings.join(" ")).toContain("1976: 1 of 0 advertised");
  });

  test("accepts a 1999 surplus over a stale advertised year count", () => {
    const result = inspectVinplusEvidence(
      tenant(),
      evidence((years) => years.set("1999", 17)),
    );
    if (result.kind !== "complete") throw new Error("Pending evidence");
    expect(result.records).toHaveLength(81);
    expect(result.warnings.join(" ")).toContain("1999: 20 of 17 advertised");
  });

  test("a surplus cannot offset another year's lag", () => {
    const result = inspectVinplusEvidence(
      tenant(),
      evidence((years) => {
        years.delete("1976");
        years.set("1998", 13);
      }),
    );
    if (result.kind !== "complete") throw new Error("Pending evidence");
    expect(result.records).toHaveLength(81);
    // 2026-11-24: a distribution unchanged since 2026-11-22 still counted
    // vehicles complete live year searches no longer returned.
    expect(result.warnings.join(" ")).toContain(
      "US Auto Supply: 2 advertised vehicles / 82 (2.439024%) are absent from complete live searches (1998: 2)",
    );
    expect(result.warnings.join(" ")).toContain("1976: 1 of 0 advertised");
    expect(result.warnings.join(" ")).not.toContain("unreachable");
  });

  /** Answers each pending control from `live` like the public backend,
   * including its silent 100-record search cap. */
  const drive = (
    analytics: string,
    live: readonly Record<string, unknown>[],
    directory: readonly string[] = [
      ...new Set(live.map((record) => String(record.make))),
    ],
  ) => {
    const searches: string[] = [];
    try {
      return { result: answer(analytics, live, directory, searches), searches };
    } catch (error) {
      return { error, searches };
    }
  };
  const answer = (
    analytics: string,
    live: readonly Record<string, unknown>[],
    directory: readonly string[],
    searches: string[],
  ) => {
    const [app, config] = vinplusCensus()[2] ?? [];
    if (!app || !config) throw new Error("Missing US Auto Supply app/config");
    const bodies: string[] = [];
    for (;;) {
      const step = inspectVinplusEvidence(tenant(), bodies);
      if (step.kind === "complete") return step;
      const { url, body } = step.control;
      if (url.endsWith("/parts/us-auto-supply")) bodies.push(app);
      else if (url.includes("/api/yard-info/")) bodies.push(config);
      else if (url.includes("/year-distribution")) bodies.push(analytics);
      else if (url.endsWith("/api/vehicle-groups")) {
        searches.push("directory");
        bodies.push(
          JSON.stringify({
            success: true,
            data: Object.fromEntries(directory.map((make) => [make, []])),
          }),
        );
      } else {
        const criteria = z
          .object({
            yard_id: z.string(),
            year_min: z.number(),
            year_max: z.number(),
            make: z.string().nullable(),
            model: z.null(),
          })
          .parse(JSON.parse(body ?? ""));
        const matches = live
          .filter(
            (record) =>
              Number(record.year) >= criteria.year_min &&
              Number(record.year) <= criteria.year_max &&
              (criteria.make === null || record.make === criteria.make),
          )
          .slice(0, 100);
        searches.push(
          `${criteria.year_min}-${criteria.year_max} ${criteria.make ?? "*"}`,
        );
        bodies.push(
          JSON.stringify({
            success: true,
            match_count: matches.length,
            matches,
            search_criteria: criteria,
          }),
        );
      }
    }
  };
  const liveRecords = () =>
    z
      .object({ matches: z.array(z.record(z.unknown())) })
      .passthrough()
      .parse(JSON.parse(vinplusUsAutoSupplyLive().search)).matches;
  /** Distinct stocks cloned from the live capture, cycling through it. */
  const extra = (
    count: number,
    patch: Record<string, unknown>,
  ): Record<string, unknown>[] => {
    const live = liveRecords();
    return Array.from({ length: count }, (_, index) => {
      const record = live[index % live.length];
      if (!record) throw new Error("Missing live US Auto Supply record");
      return {
        ...record,
        ...patch,
        stock: `STK${String(900_000 + index)}`,
      };
    });
  };

  test("lag the distribution has not confirmed is a transient rejection above 1%", () => {
    const { error } = drive(
      evidence(() => undefined)[2] ?? "",
      liveRecords().slice(9),
    );
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain(
      "9 advertised vehicles / 81 (11.111111%) are absent from complete live searches",
    );
    expect(message).toContain("This exceeds the 1% lag limit");
    expect(validationRejectionKind(error)).toBe("transient");
  });

  test("a frozen distribution's lag is published when the same yard shows arrivals", () => {
    // 2026-11-22 to 2026-11-24: one distribution while the yard turned over.
    const { result } = drive(evidence(() => undefined)[2] ?? "", [
      ...liveRecords().slice(9),
      ...extra(1, { year: 1976 }),
    ]);
    if (result?.kind !== "complete") throw new Error("Pending evidence");
    expect(result.records).toHaveLength(73);
    expect(result.warnings.join(" ")).toContain(
      "9 advertised vehicles / 81 (11.111111%) are absent from complete live searches",
    );
    expect(result.warnings.join(" ")).toContain(
      "The same searches found 1 vehicles the distribution does not count yet",
    );
  });

  test("a stale range that hits the silent 100-record cap is bisected by year instead of rejected", () => {
    const { result, searches } = drive(evidence(() => undefined)[2] ?? "", [
      ...liveRecords(),
      ...extra(19, {}),
    ]);
    if (result?.kind !== "complete") throw new Error("Pending evidence");
    expect(searches.slice(0, 3)).toEqual([
      "1960-1999 *",
      "1960-1979 *",
      "1980-1999 *",
    ]);
    expect(result.records).toHaveLength(100);
    expect(result.warnings.join(" ")).toContain(
      "19 searchable vehicles exceed the lagging year distribution",
    );
  });

  /** Serves `records` behind a distribution that advertises each year as
   * counted, except the overrides. */
  const distribution = (
    records: readonly Record<string, unknown>[],
    overrides: ReadonlyMap<number, number>,
  ) => {
    const advertised = new Map<number, number>();
    for (const record of records)
      advertised.set(
        Number(record.year),
        (advertised.get(Number(record.year)) ?? 0) + 1,
      );
    for (const [year, count] of overrides) advertised.set(year, count);
    const by_year = [...advertised].map(([year, count]) => ({
      year: String(year),
      count,
    }));
    return JSON.stringify({
      success: true,
      data: {
        current_count: by_year.reduce((sum, row) => sum + row.count, 0),
        by_year,
      },
    });
  };
  /** Live 1999 rows past the cap: discovery sees only the first 100, so
   * SAAB is reachable only through the make directory. */
  const capped1999 = (discoverable: number) => [
    ...liveRecords(),
    ...extra(discoverable, { year: 1999 }),
    ...extra(discoverable + 5, {
      year: 1999,
      make: "SAAB",
      model: "9-3",
    }).slice(discoverable),
  ];

  test("a capped single year below its stale advertised count is read by make", () => {
    const records = capped1999(80);
    // The cached distribution trails the yard's 1999 arrivals.
    const { result, searches } = drive(
      distribution(records, new Map([[1999, 95]])),
      records,
    );
    if (result?.kind !== "complete") throw new Error("Pending evidence");
    expect(searches).toContain("1999-1999 *");
    expect(searches).toContain("1999-1999 SAAB");
    expect(
      result.records.filter((record) => record.year === 1999),
    ).toHaveLength(records.filter((record) => record.year === 1999).length);
    expect(result.records).toHaveLength(records.length);
    expect(result.warnings.join(" ")).not.toContain("unreachable");
  });

  test("a capped year whose discovered makes match its advertised 100 still reads the directory", () => {
    // 1999 already has 20 rows; 80 more fill discovery to exactly 100.
    const records = capped1999(80);
    const { result, searches } = drive(
      distribution(records, new Map([[1999, 100]])),
      records,
    );
    if (result?.kind !== "complete") throw new Error("Pending evidence");
    expect(searches).toContain("1999-1999 SAAB");
    expect(result.records).toHaveLength(records.length);
  });

  test("a capped year reads each remaining directory make once, without an observed-make pass, and replays it at close", () => {
    const records = capped1999(80);
    const directory = [
      ...new Set(records.map((record) => String(record.make))),
      ...Array.from({ length: 20 }, (_, index) => `MAKE${index}`),
    ].sort();
    const { result, searches } = drive(
      distribution(records, new Map([[1999, 95]])),
      records,
      directory,
    );
    if (result?.kind !== "complete") throw new Error("Pending evidence");
    const year = searches.filter((search) => search.startsWith("1999-1999 "));
    // One capped discovery, then every directory make at opening and close.
    expect(year.filter((search) => search === "1999-1999 *")).toHaveLength(1);
    expect(year).toHaveLength(1 + 2 * directory.length);
    expect(new Set(year).size).toBe(1 + directory.length);
    // Discovery saw only the first 100 rows; every other make waits for the
    // directory, so the request limit is checked before any of them.
    const discovered = new Set(
      records
        .filter((record) => record.year === 1999)
        .slice(0, 100)
        .map((record) => `1999-1999 ${String(record.make)}`),
    );
    const firstUndiscovered = searches.findIndex(
      (search) =>
        search.startsWith("1999-1999 ") &&
        search !== "1999-1999 *" &&
        !discovered.has(search),
    );
    expect(searches.indexOf("directory")).toBeGreaterThan(-1);
    expect(searches.indexOf("directory")).toBeLessThan(firstUndiscovered);
  });

  test("capped years that would exceed the per-yard request limit are rejected before their directory reads", () => {
    const years = [1995, 1996, 1997, 1998, 1999];
    const records = [
      ...liveRecords().filter((record) => !years.includes(Number(record.year))),
      ...years.flatMap((year) => extra(105, { year })),
    ];
    const directory = [
      ...new Set(records.map((record) => String(record.make))),
      ...Array.from({ length: 100 }, (_, index) => `MAKE${index}`),
    ].sort();
    const { error, searches } = drive(
      distribution(records, new Map(years.map((year) => [year, 95]))),
      records,
      directory,
    );
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain(
      "us_auto_supply years 1995, 1996, 1997, 1998, 1999: each search reached the 100-record cap",
    );
    expect(message).toContain("above its 1024-request limit");
    expect(message).toContain(
      "VinPlus is not published this attempt and every VinPlus yard keeps its published inventory",
    );
    expect(validationRejectionKind(error)).toBe("transient");
    expect(searches.some((search) => search.includes("MAKE"))).toBe(false);
  });

  test("the capped-year request check counts directory reads by large years that never reconcile", () => {
    const capped = [1995, 1996, 1997];
    const large = [2001, 2002];
    const years = [...capped, ...large];
    /** Distinct six-digit stocks per year, so years never share a stock. */
    const rows = (year: number, count: number) =>
      extra(count, { year }).map(
        (record, index): Record<string, unknown> => ({
          ...record,
          stock: `STK${String(year).slice(2)}${String(index).padStart(4, "0")}`,
        }),
      );
    const records = [
      ...liveRecords().filter((record) => !years.includes(Number(record.year))),
      ...capped.flatMap((year) => rows(year, 105)),
      ...large.flatMap((year) => rows(year, 150)),
    ];
    const directory = [
      ...new Set(records.map((record) => String(record.make))),
      ...Array.from({ length: 100 }, (_, index) => `MAKE${index}`),
    ].sort();
    // A frozen distribution: the large years still count 10 departed
    // vehicles each, so their directory reads never stop early.
    const { error, searches } = drive(
      distribution(
        records,
        new Map([
          ...capped.map((year) => [year, 95] as const),
          ...large.map((year) => [year, 160] as const),
        ]),
      ),
      records,
      directory,
    );
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain(
      "us_auto_supply years 1995, 1996, 1997: each search reached the 100-record cap",
    );
    expect(message).toMatch(
      /\(1995: \d+ makes, 1996: \d+ makes, 1997: \d+ makes\)/,
    );
    expect(message).toContain("above its 1024-request limit");
    expect(message).toContain(
      "No directory-make search was made for these years",
    );
    expect(validationRejectionKind(error)).toBe("transient");
    // The large years read the directory first; the capped years never did.
    expect(searches).toContain("2001-2001 MAKE0");
    expect(
      searches.some(
        (search) =>
          capped.some((year) => search.startsWith(`${year}-${year} `)) &&
          search.includes("MAKE"),
      ),
    ).toBe(false);
  }, 30_000);
});

test("saved API cap reports 100 matching records while its published year range is larger", () => {
  const { capped } = z
    .object({
      capped: z.object({
        counts: z.unknown(),
        response: z
          .object({
            match_count: z.number(),
            search_criteria: z
              .object({
                year_min: z.number(),
                year_max: z.number(),
              })
              .passthrough(),
          })
          .passthrough(),
      }),
    })
    .parse(vinplusQualification());
  const { year_min: min, year_max: max } = capped.response.search_criteria;
  const records = parseVinplusYearSearch(
    JSON.stringify(capped.response),
    vinplusScope(first()),
    min,
    max,
  );
  const expected = parseVinplusAnalytics(JSON.stringify(capped.counts), 10_000)
    .years.filter((row) => row.year >= min && row.year <= max)
    .reduce((sum, row) => sum + row.count, 0);
  expect(capped.response.match_count).toBe(100);
  expect(records).toHaveLength(100);
  expect(expected).toBeGreaterThan(100);
});
test("Pick Ur Part's saved date keeps its published UTC offset", () => {
  const saved = z
    .object({
      pickUrPart: z.object({
        sample: z.object({
          matches: z.array(z.object({ dateAdded: z.string() })).min(1),
        }),
      }),
    })
    .parse(vinplusQualification());
  const date = saved.pickUrPart.sample.matches[0]?.dateAdded;
  expect(date?.endsWith("-06:00")).toBe(true);
  expect(vinplusPublicDate(date)?.value).toBe(date);
});
