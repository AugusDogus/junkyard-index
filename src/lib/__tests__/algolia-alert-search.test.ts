import { describe, expect, test } from "bun:test";

import {
  compileAlertFilters,
  scanAlertMatchPages,
  toAlertSearchPage,
  type AlertSearchPage,
} from "~/lib/algolia-alert-search";
import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";

function compileValidFilters(
  filters: Parameters<typeof compileAlertFilters>[0],
  lastCheckedAt: Date | null,
): string | undefined {
  const compilation = compileAlertFilters(filters, lastCheckedAt);
  if (compilation.kind === "no_match") {
    throw new Error("Expected valid alert filters");
  }
  return compilation.value;
}

describe("algolia alert search helpers", () => {
  test("builds timestamp and numeric year constraints", () => {
    const filters = compileValidFilters(
      { minYear: 2012, maxYear: 2018 },
      new Date("2026-01-01T00:00:01.999Z"),
    );

    expect(filters).toContain("firstSeenAt > 1767225601");
    expect(filters).toContain("year >= 2012");
    expect(filters).toContain("year <= 2018");
  });

  test("builds OR facets for multi-value filters", () => {
    const filters = compileValidFilters(
      {
        makes: ["Honda", "Toyota"],
        states: ["California", "Nevada"],
        sources: [
          "pyp",
          "row52",
          "autorecycler",
          "pullapart",
          "upullitne",
          "upullitdavie",
          "gopullit",
          "ignore-me",
        ],
      },
      null,
    );

    expect(filters).toContain('(make:"Honda" OR make:"Toyota")');
    expect(filters).toContain('(state:"California" OR state:"Nevada")');
    expect(filters).toContain(
      '(source:"pyp" OR source:"row52" OR source:"autorecycler" OR source:"pullapart" OR source:"upullitne" OR source:"upullitdavie" OR source:"gopullit")',
    );
    expect(filters).not.toContain("ignore-me");
  });

  test("builds position-aware VIN constraints", () => {
    const filters = compileValidFilters(
      { vinPattern: "YV4C[0-2]85**********" },
      null,
    );

    expect(filters).toContain('vinPositionTokens:"0:Y"');
    expect(filters).toContain(
      '(vinPositionTokens:"4:0" OR vinPositionTokens:"4:1" OR vinPositionTokens:"4:2")',
    );
  });

  test("drops empty and whitespace facet values", () => {
    const filters = compileValidFilters(
      {
        makes: ["Honda", "", "   ", "Toyota"],
      },
      null,
    );

    expect(filters).toContain('(make:"Honda" OR make:"Toyota")');
    expect(filters).not.toContain('make:""');
  });

  test("handles finite and inverted year ranges safely", () => {
    const filters = compileValidFilters(
      {
        minYear: Number.POSITIVE_INFINITY,
        maxYear: Number.NaN,
      },
      null,
    );
    expect(filters).toBeUndefined();

    const swappedRange = compileValidFilters(
      {
        minYear: 2020,
        maxYear: 2015,
      },
      null,
    );
    expect(swappedRange).toContain("year >= 2015");
    expect(swappedRange).toContain("year <= 2020");
  });

  test("rejects invalid and unconstrained VIN patterns", () => {
    expect(compileAlertFilters({ vinPattern: "YV4C*85" }, null)).toEqual({
      kind: "no_match",
    });
    expect(
      compileAlertFilters({ vinPattern: "*****************" }, null),
    ).toEqual({ kind: "no_match" });
  });

  test("maps algolia hits to search vehicle shape", () => {
    const vehicle = algoliaHitToSearchVehicle({
      objectID: "VIN123",
      year: 2015,
      make: "Honda",
      model: "Civic",
      source: "pyp",
      locationName: "PYP Sun Valley",
      locationCity: "Sun Valley",
      locationCode: "SV",
      state: "California",
      stateAbbr: "CA",
      _geoloc: { lat: 34.2, lng: -118.3 },
      imageUrl: "https://example.com/image.jpg",
    });
    if (vehicle === null) throw new Error("Expected a valid search vehicle");

    expect(vehicle.vin).toBe("VIN123");
    expect(vehicle.make).toBe("Honda");
    expect(vehicle.locationName).toBe("PYP Sun Valley");
    expect(vehicle.locationCity).toBe("Sun Valley");
    expect(vehicle.lat).toBe(34.2);
    expect(vehicle.imageUrl).toBe("https://example.com/image.jpg");
  });

  test("preserves autorecycler source on hits", () => {
    const vehicle = algoliaHitToSearchVehicle({
      objectID: "VIN456",
      year: 2012,
      make: "Ford",
      model: "Focus",
      source: "autorecycler",
      locationName: "AutoRecycler - Tampa",
      locationCity: "Tampa",
      locationCode: "org-1",
      state: "Florida",
      stateAbbr: "FL",
      _geoloc: { lat: 27.9, lng: -82.4 },
    });
    if (vehicle === null) throw new Error("Expected a valid search vehicle");
    expect(vehicle.source).toBe("autorecycler");
    expect(vehicle.locationCode).toBe("org-1");
  });

  test("drops algolia hits with unsupported sources", () => {
    expect(
      algoliaHitToSearchVehicle({ objectID: "VIN789", source: "unknown" }),
    ).toBeNull();
  });
});

describe("scanAlertMatchPages pagination", () => {
  const createHits = (
    count: number,
    prefix: string,
  ): ({ objectID: string } & Record<string, unknown>)[] =>
    Array.from({ length: count }, (_, index) => ({
      objectID: `${prefix}-${index}`,
      make: "Honda",
      model: "Civic",
      year: 2019,
      source: "pyp",
    }));
  const createPage = (
    hits: Record<string, unknown>[],
    reportedCount: number,
    reportedPageCount: number,
    countIsExhaustive: boolean,
  ): AlertSearchPage => ({
    hits,
    reportedCount,
    reportedPageCount,
    countIsExhaustive,
  });
  const complete = { status: "complete" } as const;
  const config = { hitsPerPage: 2, paginationLimit: 10 };
  const createFetcher =
    (pages: ReadonlyMap<number, AlertSearchPage>, requestedPages: number[]) =>
    async (page: number): Promise<AlertSearchPage | null> => {
      requestedPages.push(page);
      return pages.get(page) ?? null;
    };

  test("normalizes modern and legacy Algolia exhaustiveness metadata", () => {
    const hits = createHits(2, "VIN");

    expect(
      toAlertSearchPage({
        hits,
        nbHits: 2,
        nbPages: 1,
        exhaustive: { nbHits: true },
        exhaustiveNbHits: false,
      }).countIsExhaustive,
    ).toBe(true);
    expect(
      toAlertSearchPage({
        hits,
        nbHits: 2,
        nbPages: 1,
        exhaustive: { nbHits: false },
        exhaustiveNbHits: true,
      }).countIsExhaustive,
    ).toBe(false);
    expect(
      toAlertSearchPage({
        hits,
        nbHits: 2,
        nbPages: 1,
        exhaustiveNbHits: true,
      }).countIsExhaustive,
    ).toBe(true);
  });

  test("treats missing Algolia count metadata as approximate", () => {
    const page = toAlertSearchPage({
      hits: createHits(2, "VIN"),
      exhaustiveNbHits: true,
    });

    expect(page).toMatchObject({
      reportedCount: 2,
      reportedPageCount: 0,
      countIsExhaustive: false,
    });
  });

  test("aggregates multiple pages and stops at nbPages", async () => {
    const pages = new Map<number, AlertSearchPage>([
      [0, createPage(createHits(2, "VIN-A"), 4, 2, true)],
      [1, createPage(createHits(2, "VIN-B"), 4, 2, true)],
    ]);
    const requestedPages: number[] = [];

    const result = await scanAlertMatchPages(
      createFetcher(pages, requestedPages),
      config,
    );

    expect(result.matchedCount).toBe(4);
    expect(result.completion).toEqual(complete);
    expect(result.vehicles.length).toBe(4);
    expect(requestedPages).toEqual([0, 1]);
  });

  test("treats an empty page as complete when nbHits is an overestimate", async () => {
    const pages = new Map<number, AlertSearchPage>([
      [0, createPage(createHits(2, "VIN-C"), 5, 3, false)],
      [1, createPage([], 5, 3, false)],
    ]);
    const requestedPages: number[] = [];

    const result = await scanAlertMatchPages(
      createFetcher(pages, requestedPages),
      config,
    );

    expect(result.matchedCount).toBe(2);
    expect(result.completion).toEqual(complete);
    expect(requestedPages).toEqual([0, 1]);
  });

  test("stops at nbPages when the reported count is exhaustive", async () => {
    const pages = new Map<number, AlertSearchPage>([
      [0, createPage(createHits(2, "VIN-A"), 6, 3, true)],
      [1, createPage(createHits(2, "VIN-B"), 6, 3, true)],
      [2, createPage(createHits(2, "VIN-C"), 6, 3, true)],
    ]);
    const requestedPages: number[] = [];

    const result = await scanAlertMatchPages(
      createFetcher(pages, requestedPages),
      config,
    );

    expect(result.matchedCount).toBe(6);
    expect(result.completion).toEqual(complete);
    expect(requestedPages).toEqual([0, 1, 2]);
  });

  test("counts malformed hits toward scan completeness only", async () => {
    const pages = new Map<number, AlertSearchPage>([
      [
        0,
        createPage(
          [
            ...createHits(1, "VIN-VALID"),
            { objectID: "VIN-INVALID", source: "unsupported" },
          ],
          2,
          1,
          true,
        ),
      ],
    ]);

    const result = await scanAlertMatchPages(async () => pages.get(0) ?? null, {
      hitsPerPage: 2,
      paginationLimit: 10,
    });

    expect(result.matchedCount).toBe(1);
    expect(result.completion).toEqual(complete);
    expect(result.vehicles).toHaveLength(1);
  });

  test("continues past approximate nbPages when nbHits is an underestimate", async () => {
    const pages = new Map<number, AlertSearchPage>([
      [0, createPage(createHits(2, "VIN-A"), 3, 2, false)],
      [1, createPage(createHits(2, "VIN-B"), 3, 2, false)],
      [2, createPage([], 3, 2, false)],
    ]);
    const requestedPages: number[] = [];

    const result = await scanAlertMatchPages(
      createFetcher(pages, requestedPages),
      config,
    );

    expect(requestedPages).toEqual([0, 1, 2]);
    expect(result.matchedCount).toBe(4);
    expect(result.completion).toEqual(complete);
  });

  test("does not trust later approximate page counts", async () => {
    const pages = new Map<number, AlertSearchPage>([
      [0, createPage(createHits(2, "VIN-A"), 6, 3, true)],
      [1, createPage(createHits(2, "VIN-B"), 3, 2, false)],
      [2, createPage(createHits(1, "VIN-C"), 3, 2, false)],
    ]);
    const requestedPages: number[] = [];

    const result = await scanAlertMatchPages(
      createFetcher(pages, requestedPages),
      config,
    );

    expect(requestedPages).toEqual([0, 1, 2]);
    expect(result.matchedCount).toBe(5);
    expect(result.completion).toEqual(complete);
  });

  test("marks the scan incomplete when it reaches paginationLimitedTo", async () => {
    const pages = new Map<number, AlertSearchPage>([
      [0, createPage(createHits(2, "VIN-A"), 5, 3, false)],
      [1, createPage(createHits(2, "VIN-B"), 5, 3, false)],
    ]);
    const requestedPages: number[] = [];

    const result = await scanAlertMatchPages(
      createFetcher(pages, requestedPages),
      { hitsPerPage: 2, paginationLimit: 4 },
    );

    expect(requestedPages).toEqual([0, 1]);
    expect(result.matchedCount).toBe(4);
    expect(result.completion).toEqual({
      status: "incomplete",
      reason: "pagination-limit",
    });
  });

  test("marks the scan incomplete when a page response is missing", async () => {
    const result = await scanAlertMatchPages(async () => null, config);

    expect(result).toEqual({
      matchedCount: 0,
      completion: { status: "incomplete", reason: "missing-page" },
      vehicles: [],
    });
  });
});
