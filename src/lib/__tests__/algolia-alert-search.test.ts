import { afterEach, describe, expect, test } from "bun:test";

import {
  buildAlertFiltersString,
  getAlertMatchStats,
} from "~/lib/algolia-alert-search";
import { searchClient } from "~/lib/algolia-search";
import { MAX_VEHICLE_YEAR, MIN_VEHICLE_YEAR } from "~/lib/search-filter-bounds";
import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";

describe("algolia alert search helpers", () => {
  test("builds timestamp and numeric year constraints", () => {
    const filters = buildAlertFiltersString(
      { minYear: 2012, maxYear: 2018 },
      new Date("2026-01-01T00:00:01.999Z"),
    );

    expect(filters).toContain("firstSeenAt > 1767225601");
    expect(filters).toContain("year >= 2012");
    expect(filters).toContain("year <= 2018");
  });

  test("builds OR facets for multi-value filters", () => {
    const filters = buildAlertFiltersString(
      {
        makes: ["Honda", "Toyota"],
        states: ["California", "Nevada"],
        sources: [
          "pyp",
          "row52",
          "autorecycler",
          "pullapart",
          "upullitne",
          "ignore-me",
        ],
      },
      null,
    );

    expect(filters).toContain('(make:"Honda" OR make:"Toyota")');
    expect(filters).toContain('(state:"California" OR state:"Nevada")');
    expect(filters).toContain(
      '(source:"pyp" OR source:"row52" OR source:"autorecycler" OR source:"pullapart" OR source:"upullitne")',
    );
    expect(filters).not.toContain("ignore-me");
  });

  test("drops empty and whitespace facet values", () => {
    const filters = buildAlertFiltersString(
      {
        makes: ["Honda", "", "   ", "Toyota"],
      },
      null,
    );

    expect(filters).toContain('(make:"Honda" OR make:"Toyota")');
    expect(filters).not.toContain('make:""');
  });

  test("handles finite and inverted year ranges safely", () => {
    const filters = buildAlertFiltersString(
      {
        minYear: Number.POSITIVE_INFINITY,
        maxYear: Number.NaN,
      },
      null,
    );
    expect(filters).toBeUndefined();

    const swappedRange = buildAlertFiltersString(
      {
        minYear: 2020,
        maxYear: 2015,
      },
      null,
    );
    expect(swappedRange).toContain("year >= 2015");
    expect(swappedRange).toContain("year <= 2020");
  });

  test("clamps years to sane vehicle bounds", () => {
    const filters = buildAlertFiltersString(
      {
        minYear: MIN_VEHICLE_YEAR - 20,
        maxYear: MAX_VEHICLE_YEAR + 50,
      },
      null,
    );

    expect(filters).toBeUndefined();
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
    expect(vehicle.source).toBe("autorecycler");
    expect(vehicle.locationCode).toBe("org-1");
  });
});

describe("getAlertMatchStats pagination", () => {
  const originalSearchForHits = searchClient.searchForHits;
  type SearchParams = Parameters<typeof searchClient.searchForHits>[0];
  const createHits = (
    count: number,
    prefix: string,
  ): Record<string, unknown>[] =>
    Array.from({ length: count }, (_, index) => ({
      objectID: `${prefix}-${index}`,
      make: "Honda",
      model: "Civic",
      year: 2019,
    }));
  const getRequestedPage = (params: SearchParams): number => {
    if (typeof params === "object" && params !== null && "requests" in params) {
      const request = params.requests[0];
      if (request && typeof request === "object" && "page" in request) {
        const page = request.page;
        return typeof page === "number" ? page : 0;
      }
    }
    return 0;
  };

  function mockSearchForHits(fn: typeof searchClient.searchForHits): void {
    Object.defineProperty(searchClient, "searchForHits", {
      configurable: true,
      writable: true,
      value: fn,
    });
  }

  function restoreSearchForHits(): void {
    mockSearchForHits(originalSearchForHits);
  }

  afterEach(() => {
    restoreSearchForHits();
  });

  test("aggregates multiple pages and stops at nbPages", async () => {
    const pages = new Map<number, { hits: Record<string, unknown>[] }>([
      [
        0,
        {
          hits: createHits(100, "VIN-A"),
        },
      ],
      [
        1,
        {
          hits: createHits(100, "VIN-B"),
        },
      ],
    ]);
    const requestedPages: number[] = [];

    mockSearchForHits((async (params) => {
      const page = getRequestedPage(params);
      requestedPages.push(page);
      const payload = pages.get(page) ?? { hits: [] };
      return {
        results: [
          {
            hits: payload.hits,
            nbHits: 200,
            nbPages: 2,
          },
        ],
      } as Awaited<ReturnType<typeof searchClient.searchForHits>>;
    }) as typeof searchClient.searchForHits);

    const result = await getAlertMatchStats("honda", {}, null);
    expect(result.fullCount).toBe(200);
    expect(result.vehicles.length).toBe(200);
    expect(requestedPages).toEqual([0, 1]);
  });

  test("stops when a subsequent page has empty hits", async () => {
    const requestedPages: number[] = [];

    mockSearchForHits((async (params) => {
      const page = getRequestedPage(params);
      requestedPages.push(page);
      if (page === 0) {
        return {
          results: [
            {
              hits: createHits(100, "VIN-C"),
              nbHits: 500,
              nbPages: 50,
            },
          ],
        } as Awaited<ReturnType<typeof searchClient.searchForHits>>;
      }
      return {
        results: [
          {
            hits: [],
            nbHits: 500,
            nbPages: 50,
          },
        ],
      } as Awaited<ReturnType<typeof searchClient.searchForHits>>;
    }) as typeof searchClient.searchForHits);

    const result = await getAlertMatchStats("ford", {}, null);
    expect(result.fullCount).toBe(500);
    expect(result.vehicles.length).toBe(100);
    expect(requestedPages).toEqual([0, 1]);
  });

  test("stops even with repeated page payloads by fullCount", async () => {
    let callCount = 0;

    mockSearchForHits((async () => {
      callCount += 1;
      return {
        results: [
          {
            hits: createHits(100, `VIN-${callCount}`),
            nbHits: 300,
          },
        ],
      } as Awaited<ReturnType<typeof searchClient.searchForHits>>;
    }) as typeof searchClient.searchForHits);

    const result = await getAlertMatchStats("mazda", {}, null);
    expect(result.fullCount).toBe(300);
    expect(result.vehicles.length).toBe(300);
    expect(callCount).toBe(3);
  });
});
