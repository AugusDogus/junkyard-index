import { getAlertMatchStatsWithClient } from "./alert-match-search";
import type { YardType } from "./yard-service";
import { describe, expect, test } from "bun:test";
import { SearchYardSelection } from "./search-yard-selection";
import { buildSearchUrl } from "./search-utils";
import { createSearchRouting } from "~/components/search/search-routing";
import { compileAlertFilters } from "./algolia-alert-search";
import { SearchCriteria } from "./search-criteria";
import { parseSavedSearchFilters } from "./saved-search-filters";

const routing = createSearchRouting("vehicles", true, false);
function restore(url: URL) {
  return routing.stateMapping.routeToState(
    routing.router.parseURL({
      location: { href: url.href, search: url.search },
    }),
  );
}

describe("search yard selection", () => {
  test("missing and invalid shared values default to self-service even for free search", () => {
    for (const query of ["", "yardTypes=unknown"]) {
      const selection = SearchYardSelection.fromUrl(new URLSearchParams(query));
      expect(selection).toEqual({ kind: "default" });
      expect(SearchYardSelection.effectiveTypes(selection)).toEqual([
        "self_service",
      ]);
      expect(
        restore(new URL(`https://example.com/search?${query}`)).vehicles
          ?.refinementList,
      ).toEqual({ yardTypes: ["self_service"] });
    }
  });

  test.each([
    { types: [] },
    { types: ["self_service"] },
    { types: ["full_service"] },
    { types: ["self_service", "full_service"] },
  ] satisfies { types: YardType[] }[])(
    "explicit selection round-trips: $types",
    ({ types }) => {
      const selection = SearchYardSelection.fromSaved([...types]);
      const url = new URL(
        buildSearchUrl("Volvo", { yardTypes: [...types] }),
        "https://example.com",
      );
      expect(SearchYardSelection.fromUrl(url.searchParams)).toEqual(selection);
      const state = restore(url);
      expect(state.vehicles?.refinementList).toEqual({ yardTypes: [...types] });
      const rewritten = new URL(
        routing.router.createURL({
          routeState: routing.stateMapping.stateToRoute(state),
          location: { href: url.href, search: url.search },
        }),
      );
      expect(SearchYardSelection.fromUrl(rewritten.searchParams)).toEqual(
        selection,
      );
    },
  );

  test("legacy saved searches and alert URLs keep all types through editing", () => {
    const parsed = parseSavedSearchFilters("{}");
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const saved = SearchCriteria.toSavedSearch(
      SearchCriteria.fromSavedSearch("Volvo", parsed.data),
    );
    expect(saved.success).toBe(true);
    if (!saved.success) return;
    const legacyAlert = compileAlertFilters(saved.data.filters, null);
    expect(legacyAlert.kind).toBe("filter");
    expect(legacyAlert.kind === "filter" && legacyAlert.value).not.toContain(
      "yardTypes",
    );
    expect(compileAlertFilters(parsed.data, null)).toEqual({
      kind: "filter",
      value: undefined,
    });
    const url = new URL(
      buildSearchUrl(saved.data.query, saved.data.filters),
      "https://example.com",
    );
    expect(url.searchParams.get("yardTypes")).toBe("all");
    expect(restore(url).vehicles?.refinementList).toEqual({ yardTypes: [] });
  });

  test("new default searches persist self-service for alerts", () => {
    const types = SearchYardSelection.effectiveTypes({ kind: "default" });
    const saved = SearchCriteria.toSavedSearch(
      SearchCriteria.fromSavedSearch("Volvo", { yardTypes: types }),
    );
    expect(saved.success).toBe(true);
    if (!saved.success) return;
    expect(saved.data.filters.yardTypes).toEqual(["self_service"]);
    const newAlert = compileAlertFilters(saved.data.filters, null);
    expect(newAlert.kind === "filter" && newAlert.value).toContain(
      'yardTypes:"self_service"',
    );
  });

  test("fallback is used below three matches, only when extra matches exist", () => {
    for (const count of [0, 1, 2])
      expect(SearchYardSelection.suggestion(count, 3)).toBe("fallback");
    for (const count of [3, 4, 100])
      expect(SearchYardSelection.suggestion(count, 3)).toBe("hint");
    for (const count of [0, 2, 3])
      expect(SearchYardSelection.suggestion(count, 0)).toBe("none");
  });
});

const expressionRouting = createSearchRouting("vehicles", true, true);
for (const expression of [
  "yardType:full_service",
  "yardType:self_service",
  "yardType:self_service OR yardType:full_service",
  "(yardType:full_service AND make:Volvo) OR make:Honda",
]) {
  test(`expression yard terms suppress the implicit facet: ${expression}`, () => {
    const url = new URL("https://example.com/search");
    url.searchParams.set("syntax", "expression");
    url.searchParams.set("q", expression);
    const state = expressionRouting.stateMapping.routeToState(
      expressionRouting.router.parseURL({
        location: { href: url.href, search: url.search },
      }),
    );
    expect(state.vehicles?.refinementList).toEqual({ yardTypes: [] });
    const rewritten = new URL(
      expressionRouting.router.createURL({
        routeState: expressionRouting.stateMapping.stateToRoute(state),
        location: { href: url.href, search: url.search },
      }),
    );
    expect(
      expressionRouting.stateMapping.routeToState(
        expressionRouting.router.parseURL({
          location: { href: rewritten.href, search: rewritten.search },
        }),
      ).vehicles?.refinementList,
    ).toEqual({ yardTypes: [] });
  });
}

test("quoted field-looking text and ordinary keyword searches still default to self-service", () => {
  for (const search of [
    "q=yardType%3Afull_service",
    "syntax=expression&q=%22yardType%3Afull_service%22",
    "syntax=expression&q=make%3AVolvo",
  ]) {
    const url = new URL(`https://example.com/search?${search}`);
    const state = expressionRouting.stateMapping.routeToState(
      expressionRouting.router.parseURL({
        location: { href: url.href, search: url.search },
      }),
    );
    expect(state.vehicles?.refinementList).toEqual({
      yardTypes: ["self_service"],
    });
  }
});

test("explicit URL facets remain authoritative alongside expression terms", () => {
  const url = new URL(
    "https://example.com/search?syntax=expression&q=yardType%3Afull_service&yardTypes%5B%5D=self_service",
  );
  const state = expressionRouting.stateMapping.routeToState(
    expressionRouting.router.parseURL({
      location: { href: url.href, search: url.search },
    }),
  );
  expect(state.vehicles?.refinementList).toEqual({
    yardTypes: ["self_service"],
  });
});

test("a saved full-service expression and its alert retain full-service-only matches", async () => {
  const stored = parseSavedSearchFilters(
    JSON.stringify({ expression: "yardType:full_service AND make:Volvo" }),
  );
  expect(stored.success).toBe(true);
  if (!stored.success) return;
  const url = new URL(buildSearchUrl("", stored.data), "https://example.com");
  const state = expressionRouting.stateMapping.routeToState(
    expressionRouting.router.parseURL({
      location: { href: url.href, search: url.search },
    }),
  );
  expect(state.vehicles?.refinementList).toEqual({ yardTypes: [] });
  const alertFilters: (string | undefined)[] = [];
  await getAlertMatchStatsWithClient(
    {
      async searchForHits({ requests }) {
        alertFilters.push(...requests.map((request) => request.filters));
        return {
          results: [
            { hits: [], nbHits: 0, page: 0, nbPages: 0, hitsPerPage: 100 },
          ],
        };
      },
    },
    "",
    stored.data,
    null,
  );
  expect(alertFilters).toEqual(['yardTypes:"full_service" AND make:"Volvo"']);
});
