import { describe, expect, test } from "bun:test";
import { ALGOLIA_INDEX_NAME } from "~/lib/constants";
import { createSearchRouting } from "./search-routing";

const LOCATION = {
  href: "https://example.com/search?q=1fadp3f29fl123456",
  search: "?q=1fadp3f29fl123456",
};

describe("search routing", () => {
  test("keeps a ready VIN pattern out of Algolia's text query state", () => {
    const readyRouting = createSearchRouting(ALGOLIA_INDEX_NAME, true);
    const disabledRouting = createSearchRouting(ALGOLIA_INDEX_NAME, false);

    expect(readyRouting.router.parseURL({ location: LOCATION })).toEqual({
      [ALGOLIA_INDEX_NAME]: {},
    });
    expect(disabledRouting.router.parseURL({ location: LOCATION })).toEqual({
      [ALGOLIA_INDEX_NAME]: { query: "1fadp3f29fl123456" },
    });
  });

  test("normalizes a ready VIN when rebuilding the URL", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true);

    expect(
      routing.router.createURL({
        routeState: { [ALGOLIA_INDEX_NAME]: {} },
        location: LOCATION,
      }),
    ).toBe("https://example.com/search?q=1FADP3F29FL123456");
  });

  test("maps stable sort keys and removes unknown sources", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true);

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
});
