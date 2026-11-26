import { describe, expect, test } from "bun:test";
import { createSearchRouting } from "~/components/search/search-routing";
import { SearchCriteria } from "~/lib/search-criteria";
import {
  parseSavedSearchFilters,
  SEARCHABLE_VEHICLE_YEAR_RANGE,
  type SavedSearchFilters,
} from "~/lib/saved-search-filters";
import { compileAlertFilters } from "~/lib/algolia-alert-search";
import { buildSearchUrl } from "~/lib/search-utils";

describe("buildSearchUrl", () => {
  test("uses q for ordinary text searches", () => {
    expect(buildSearchUrl("Volvo XC90", {})).toBe(
      "/search?q=Volvo+XC90&yardTypes%5B%5D=all",
    );
  });

  test("omits the self-service default and keeps legacy all types", () => {
    expect(buildSearchUrl("Volvo", { yardTypes: ["self_service"] })).toBe(
      "/search?q=Volvo",
    );
    expect(buildSearchUrl("Volvo", { yardTypes: [] })).toBe(
      "/search?q=Volvo&yardTypes%5B%5D=all",
    );
    expect(
      buildSearchUrl("", {
        expression: "yardType:full_service",
        yardTypes: [],
      }),
    ).toBe("/search?q=yardType%3Afull_service&syntax=expression");
  });

  test("uses q for VIN pattern searches", () => {
    expect(
      buildSearchUrl(null, {
        vinPattern: "YV4C*85**********",
        states: ["California"],
      }),
    ).toBe(
      "/search?q=YV4C*85**********&states%5B%5D=California&yardTypes%5B%5D=all",
    );
  });
});

test("saved filters retain comma yards through storage, reopening, editing, and alerts", () => {
  const filters = {
    salvageYards: [
      "RTP Pick-A-Part - Hebron, KY",
      "RTP Pick-A-Part - Lexington, KY",
    ],
    yardTypes: ["self_service", "full_service"],
    sortBy: "newest",
  };
  const stored = parseSavedSearchFilters(JSON.stringify(filters));
  expect(stored.success).toBe(true);
  if (!stored.success) return;
  const edited = SearchCriteria.toSavedSearch(
    SearchCriteria.fromSavedSearch("Honda Civic", stored.data),
  );
  expect(edited.success).toBe(true);
  if (!edited.success) return;
  expect(edited.data.filters.salvageYards).toEqual(filters.salvageYards);
  const url = new URL(
    buildSearchUrl(edited.data.query, edited.data.filters),
    "https://example.com",
  );
  const routing = createSearchRouting("vehicles", true, true);
  const restored = routing.stateMapping.routeToState(
    routing.router.parseURL({
      location: { href: url.href, search: url.search },
    }),
  );
  expect(restored.vehicles?.refinementList).toEqual({
    locationName: filters.salvageYards,
    yardTypes: filters.yardTypes,
  });
  expect(compileAlertFilters(stored.data, null)).toEqual({
    kind: "filter",
    value:
      '(locationName:"RTP Pick-A-Part - Hebron, KY" OR locationName:"RTP Pick-A-Part - Lexington, KY") AND (yardTypes:"self_service" OR yardTypes:"full_service")',
  });
});

describe("saved search URLs are already canonical", () => {
  // Reopening a saved search needs Lite, so use the paid, fully ready router.
  const routing = createSearchRouting("vehicles", true, true);
  function rewrite(href: string) {
    const location = new URL(href);
    return routing.router.createURL({
      location,
      routeState: routing.stateMapping.stateToRoute(
        routing.stateMapping.routeToState(
          routing.router.parseURL({ location }),
        ),
      ),
    });
  }

  const cases: [string, string | null, SavedSearchFilters][] = [
    ["query only", "Volvo", {}],
    [
      "owner example with the default sort",
      "Volvo",
      { yardTypes: [], minYear: 1963, maxYear: 2000, sortBy: "newest" },
    ],
    ["non-default sort", "Volvo", { sortBy: "oldest" }],
    ["relevance sort", "Volvo", { sortBy: "relevance" }],
    ["distance sort", "", { sortBy: "distance" }],
    ["sort stored as an index name", "Volvo", { sortBy: "vehicles_oldest" }],
    ["unknown sort", "Volvo", { sortBy: "cheapest" }],
    ["all yard types", "Saab", { yardTypes: [] }],
    ["self-service default", "Saab", { yardTypes: ["self_service"] }],
    ["full-service only", "Saab", { yardTypes: ["full_service"] }],
    [
      "multiple yard types",
      "Saab",
      { yardTypes: ["self_service", "full_service"] },
    ],
    ["minimum year", "Civic", { minYear: 1995 }],
    ["maximum year", "Civic", { maxYear: 2005 }],
    [
      "full searchable year range",
      "Civic",
      {
        minYear: SEARCHABLE_VEHICLE_YEAR_RANGE.min,
        maxYear: SEARCHABLE_VEHICLE_YEAR_RANGE.max,
      },
    ],
    [
      "facets",
      "",
      {
        makes: ["Honda", "Example, Motors"],
        colors: ["Blue"],
        states: ["Kentucky", "Ohio"],
        salvageYards: ["RTP Pick-A-Part - Hebron, KY"],
        sources: ["pyp", "row52"],
        yardTypes: ["self_service"],
      },
    ],
    ["arrival window", "Volvo", { arrivalWindow: "7d" }],
    [
      "nearby area",
      "Volvo",
      { near: { lat: 38.25, lng: -85.76, radiusMiles: 50 } },
    ],
    [
      "expression syntax",
      "",
      { expression: "make:Volvo AND year:1990..2000", sortBy: "oldest" },
    ],
    [
      "expression owning its yard types",
      "",
      { expression: "yardType:full_service", yardTypes: [] },
    ],
    ["VIN pattern", null, { vinPattern: "yv4c*85**********" }],
    ["VIN typed as the query", "1fadp3f29fl123456", {}],
    [
      "everything at once",
      "Volvo 240",
      {
        makes: ["Volvo"],
        states: ["Kentucky"],
        sources: ["pyp"],
        yardTypes: ["full_service"],
        minYear: 1975,
        maxYear: 1993,
        arrivalWindow: "48h",
        near: { lat: 38.25, lng: -85.76, radiusMiles: 100 },
        sortBy: "year-desc",
      },
    ],
  ];

  for (const [name, query, filters] of cases) {
    test(name, () => {
      const href = new URL(
        buildSearchUrl(query, filters),
        "https://example.com",
      ).href;
      expect(href).toBe(rewrite(href));
    });
  }
});
