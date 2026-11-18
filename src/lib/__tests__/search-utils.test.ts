import { describe, expect, test } from "bun:test";
import { createSearchRouting } from "~/components/search/search-routing";
import { SearchCriteria } from "~/lib/search-criteria";
import { parseSavedSearchFilters } from "~/lib/saved-search-filters";
import { compileAlertFilters } from "~/lib/algolia-alert-search";
import { buildSearchUrl } from "~/lib/search-utils";

describe("buildSearchUrl", () => {
  test("uses q for ordinary text searches", () => {
    expect(buildSearchUrl("Volvo XC90", {})).toBe("/search?q=Volvo+XC90");
  });

  test("uses q for VIN pattern searches", () => {
    expect(
      buildSearchUrl(null, {
        vinPattern: "YV4C*85**********",
        states: ["California"],
      }),
    ).toBe("/search?q=YV4C*85**********&states%5B%5D=California");
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
