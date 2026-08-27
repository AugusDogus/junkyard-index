import { describe, expect, test } from "bun:test";
import { ALGOLIA_INDEX_NAME } from "~/lib/constants";
import { createSearchRouting } from "./search-routing";

const LOCATION = {
  href: "https://example.com/search?q=1fadp3f29fl123456",
  search: "?q=1fadp3f29fl123456",
};

describe("search routing", () => {
  test("keeps a ready VIN pattern out of Algolia's text query state", () => {
    const readyRouting = createSearchRouting(ALGOLIA_INDEX_NAME, true, true);
    const disabledRouting = createSearchRouting(
      ALGOLIA_INDEX_NAME,
      false,
      true,
    );

    expect(readyRouting.router.parseURL({ location: LOCATION })).toEqual({
      [ALGOLIA_INDEX_NAME]: {},
    });
    expect(disabledRouting.router.parseURL({ location: LOCATION })).toEqual({
      [ALGOLIA_INDEX_NAME]: { query: "1fadp3f29fl123456" },
    });
  });

  test("normalizes a ready VIN when rebuilding the URL", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true, true);

    expect(
      routing.router.createURL({
        routeState: { [ALGOLIA_INDEX_NAME]: {} },
        location: LOCATION,
      }),
    ).toBe("https://example.com/search?q=1FADP3F29FL123456");
  });

  test("maps stable sort keys and removes unknown sources", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true, true);

    expect(
      routing.stateMapping.routeToState({
        [ALGOLIA_INDEX_NAME]: {
          sort: "oldest",
          sources: ["pyp", "unknown"],
        },
      }),
    ).toEqual({
      [ALGOLIA_INDEX_NAME]: {
        sortBy: "vehicles_oldest",
        refinementList: { source: ["pyp"] },
      },
    });
  });

  test("omits untouched year bounds from the URL", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true, true);
    const maximumYear = new Date().getUTCFullYear() + 1;
    const routeState = routing.stateMapping.stateToRoute({
      [ALGOLIA_INDEX_NAME]: {
        range: { year: `1900:${maximumYear}` },
      },
    });

    expect(
      routing.router.createURL({
        routeState,
        location: {
          href: "https://example.com/search",
          search: "",
        },
      }),
    ).toBe("https://example.com/search");
  });

  test("keeps only changed year bounds in the URL", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true, true);
    const maximumYear = new Date().getUTCFullYear() + 1;

    expect(
      routing.stateMapping.stateToRoute({
        [ALGOLIA_INDEX_NAME]: {
          range: { year: `2000:${maximumYear}` },
        },
      }),
    ).toEqual({
      [ALGOLIA_INDEX_NAME]: { minYear: 2000 },
    });
    expect(
      routing.stateMapping.stateToRoute({
        [ALGOLIA_INDEX_NAME]: {
          range: { year: "1900:2020" },
        },
      }),
    ).toEqual({
      [ALGOLIA_INDEX_NAME]: { maxYear: 2020 },
    });
  });

  test("removes restricted filters before building free-tier search state", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true, false);
    const routeState = routing.router.parseURL({
      location: {
        href: "https://example.com/search?q=civic&makes=Honda&minYear=2010",
        search: "?q=civic&makes=Honda&minYear=2010",
      },
    });

    expect(routing.stateMapping.routeToState(routeState)).toEqual({
      [ALGOLIA_INDEX_NAME]: { query: "civic" },
    });
  });

  test("preserves locked filter URLs but lets authorized users clear them", () => {
    const location = {
      href: "https://example.com/search?q=civic&makes=Honda",
      search: "?q=civic&makes=Honda",
    };
    const routeState = {
      [ALGOLIA_INDEX_NAME]: { query: "civic" },
    };

    expect(
      createSearchRouting(ALGOLIA_INDEX_NAME, true, false).router.createURL({
        routeState,
        location,
      }),
    ).toBe("https://example.com/search?q=civic&makes=Honda");
    expect(
      createSearchRouting(ALGOLIA_INDEX_NAME, true, true).router.createURL({
        routeState,
        location,
      }),
    ).toBe("https://example.com/search?q=civic");
  });

  test("preserves the saved-search editing context while filters change", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true, true);

    expect(
      routing.router.createURL({
        routeState: {
          [ALGOLIA_INDEX_NAME]: { query: "civic", minYear: 2008 },
        },
        location: {
          href: "https://example.com/search?q=civic&editSearch=search-1",
          search: "?q=civic&editSearch=search-1",
        },
      }),
    ).toBe(
      "https://example.com/search?editSearch=search-1&q=civic&minYear=2008",
    );
  });
});
