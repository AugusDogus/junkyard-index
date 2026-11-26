import { describe, expect, test } from "bun:test";
import { ALGOLIA_INDEX_NAME } from "~/lib/constants";
import {
  createSearchRouting,
  getSearchSortIndex,
  getSearchSortKey,
  SEARCH_SORT_OPTIONS,
} from "./search-routing";

const LOCATION = {
  href: "https://example.com/search?q=1fadp3f29fl123456",
  search: "?q=1fadp3f29fl123456",
};

describe("search routing", () => {
  test("retains a free radius when changing a query or sort", () => {
    const routing = createSearchRouting("vehicles", true, false);
    const location = {
      href: "https://example.com/search?radius=50",
      search: "?radius=50",
    };
    const url = new URL(
      routing.router.createURL({
        location,
        routeState: {
          vehicles: { query: "2010-14 Ford F-150", sort: "oldest" },
        },
      }),
    );
    expect(url.searchParams.get("radius")).toBe("50");
    expect(url.searchParams.get("sort")).toBe("oldest");
  });
  test("round-trips both distance URL forms without conflating distance with newest", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true, true);
    for (const sort of ["distance", "vehicles_distance"]) {
      const location = {
        href: `https://example.com/search?sort=${sort}`,
        search: `?sort=${sort}`,
      };
      const parsed = routing.router.parseURL({ location });
      const state = routing.stateMapping.routeToState(parsed);
      expect(state).toEqual({
        vehicles: {
          sortBy: "vehicles_distance",
          refinementList: { yardTypes: ["self_service"] },
        },
      });
      expect(
        routing.router.createURL({
          location,
          routeState: routing.stateMapping.stateToRoute(state),
        }),
      ).toBe("https://example.com/search?sort=distance");
    }
    expect(getSearchSortIndex("distance")).toBe("vehicles_distance");
    expect(getSearchSortKey("vehicles_distance")).toBe("distance");
    expect(getSearchSortKey("vehicles")).toBe("relevance");
    expect(
      SEARCH_SORT_OPTIONS.find((option) => option.key === "distance")?.label,
    ).toBe("Distance (Nearest)");
  });
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
        refinementList: { source: ["pyp"], yardTypes: ["self_service"] },
      },
    });
  });

  test("omits untouched year bounds from the URL", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true, true);
    const maximumYear = new Date().getUTCFullYear() + 1;
    const routeState = routing.stateMapping.stateToRoute({
      [ALGOLIA_INDEX_NAME]: {
        sortBy: "vehicles_newest",
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
    ).toBe("https://example.com/search?yardTypes%5B%5D=all");
  });

  test("keeps only changed year bounds in the URL", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true, true);
    const maximumYear = new Date().getUTCFullYear() + 1;

    expect(
      routing.stateMapping.stateToRoute({
        [ALGOLIA_INDEX_NAME]: {
          sortBy: "vehicles_newest",
          range: { year: `2000:${maximumYear}` },
        },
      }),
    ).toEqual({
      [ALGOLIA_INDEX_NAME]: { minYear: 2000, yardTypes: ["all"] },
    });
    expect(
      routing.stateMapping.stateToRoute({
        [ALGOLIA_INDEX_NAME]: {
          sortBy: "vehicles_newest",
          range: { year: "1900:2020" },
        },
      }),
    ).toEqual({
      [ALGOLIA_INDEX_NAME]: { maxYear: 2020, yardTypes: ["all"] },
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
      [ALGOLIA_INDEX_NAME]: {
        query: "civic",
        sortBy: "vehicles_newest",
        range: { year: "2010:" },
        refinementList: { yardTypes: ["self_service"] },
      },
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
});

test("retains expression syntax while editing and sorting results, clears it with the query", () => {
  const routing = createSearchRouting(ALGOLIA_INDEX_NAME, true, true);
  const location = {
    href: "https://example.com/search?q=make%3AVolvo&syntax=expression",
    search: "?q=make%3AVolvo&syntax=expression",
  };
  const state = routing.router.parseURL({ location });
  expect(state[ALGOLIA_INDEX_NAME]?.query).toBe("make:Volvo");
  const url = routing.router.createURL({
    location,
    routeState: {
      [ALGOLIA_INDEX_NAME]: { query: "make:Saab", sort: "oldest" },
    },
  });
  expect(new URL(url).searchParams.get("syntax")).toBe("expression");
  expect(new URL(url).searchParams.get("q")).toBe("make:Saab");
  expect(
    routing.router.createURL({
      location,
      routeState: { [ALGOLIA_INDEX_NAME]: {} },
    }),
  ).toBe("https://example.com/search");
});

const COMMA_YARDS = [
  "RTP Pick-A-Part - Hebron, KY",
  "RTP Pick-A-Part - Lexington, KY",
];

test("round-trips comma-containing facets and multiple yards without a dictionary", () => {
  const routing = createSearchRouting("vehicles", true, true);
  for (const yards of [
    COMMA_YARDS.slice(0, 1),
    COMMA_YARDS,
    ["Future Yard, Inc."],
  ]) {
    const state = {
      vehicles: {
        refinementList: {
          make: ["Example, Motors", "Honda"],
          color: ["Blue, metallic"],
          state: ["Kentucky", "Ohio"],
          locationName: yards,
          source: ["row52", "pyp"],
          yardTypes: ["self_service", "full_service"],
        },
      },
    };
    const url = new URL(
      routing.router.createURL({
        routeState: routing.stateMapping.stateToRoute(state),
        location: { href: "https://example.com/search", search: "" },
      }),
    );
    const restored = routing.stateMapping.routeToState(
      routing.router.parseURL({
        location: { href: url.href, search: url.search },
      }),
    );
    expect(restored.vehicles?.refinementList).toEqual(
      state.vehicles.refinementList,
    );
  }
});

test("recovers legacy comma lists using longest known yard names", () => {
  const routing = createSearchRouting("vehicles", true, true, {
    knownYardNames: [...COMMA_YARDS, "RTP Pick-A-Part - Hebron"],
  });
  for (const yards of [
    COMMA_YARDS.slice(0, 1),
    COMMA_YARDS,
    ["Other Yard", ...COMMA_YARDS],
  ]) {
    const params = new URLSearchParams({ yards: yards.join(",") });
    const location = {
      href: `https://example.com/search?${params}`,
      search: `?${params}`,
    };
    expect(routing.router.parseURL({ location }).vehicles?.yards).toEqual(
      yards,
    );
  }
});

test("preserves every repeated locked filter when editing a guest query", () => {
  const routing = createSearchRouting("vehicles", true, false);
  const params = new URLSearchParams();
  for (const yard of COMMA_YARDS) params.append("yards[]", yard);
  for (const type of ["self_service", "full_service"])
    params.append("yardTypes[]", type);
  const url = new URL(
    routing.router.createURL({
      routeState: routing.stateMapping.stateToRoute(
        routing.stateMapping.routeToState(
          routing.router.parseURL({
            location: {
              href: `https://example.com/search?${params}`,
              search: `?${params}`,
            },
          }),
        ),
      ),
      location: {
        href: `https://example.com/search?${params}`,
        search: `?${params}`,
      },
    }),
  );
  expect(url.searchParams.getAll("yards[]")).toEqual(COMMA_YARDS);
  expect(url.searchParams.getAll("yardTypes[]")).toEqual([
    "self_service",
    "full_service",
  ]);
});

test("default and explicit newest routes select the chronological replica", () => {
  const routing = createSearchRouting("vehicles", true, true);
  for (const sort of [undefined, "newest", "vehicles_newest"]) {
    expect(
      routing.stateMapping.routeToState({ vehicles: sort ? { sort } : {} }),
    ).toEqual({
      vehicles: {
        sortBy: "vehicles_newest",
        refinementList: { yardTypes: ["self_service"] },
      },
    });
  }
  expect(getSearchSortKey("vehicles")).toBe("relevance");
  expect(getSearchSortIndex("relevance")).toBe("vehicles");
  expect(
    routing.stateMapping.stateToRoute({ vehicles: { sortBy: "vehicles" } }),
  ).toEqual({ vehicles: { sort: "relevance", yardTypes: ["all"] } });
  // InstantSearch omits sortBy when the primary index is selected.
  expect(routing.stateMapping.stateToRoute({ vehicles: {} })).toEqual({
    vehicles: { sort: "relevance", yardTypes: ["all"] },
  });
});

test("uses honest relevance sorting until the chronological replica is ready", () => {
  const routing = createSearchRouting("vehicles", true, true, {
    newestSortReady: false,
  });
  for (const sort of [undefined, "newest", "vehicles_newest", "relevance"]) {
    expect(
      routing.stateMapping.routeToState({ vehicles: sort ? { sort } : {} }),
    ).toEqual({
      vehicles: {
        sortBy: "vehicles",
        refinementList: { yardTypes: ["self_service"] },
      },
    });
  }
});

test("free arrival links retain repeated yard scope, year, and window", () => {
  const routing = createSearchRouting("vehicles", true, false);
  const url = new URL(
    "https://example.com/search?arrivalWindow[]=7d&yards[]=RTP%20Pick-A-Part%20-%20Hebron,%20KY&sources[]=rtp&minYear=2000",
  );
  const route = routing.router.parseURL({ location: url });
  const state = routing.stateMapping.routeToState(route);
  expect(state.vehicles).toMatchObject({
    refinementList: {
      locationName: ["RTP Pick-A-Part - Hebron, KY"],
      source: ["rtp"],
      yardTypes: ["self_service"],
    },
    range: { year: "2000:" },
  });
  const written = new URL(
    routing.router.createURL({
      routeState: routing.stateMapping.stateToRoute(state),
      location: url,
    }),
  );
  expect(written.searchParams.getAll("arrivalWindow[]")).toEqual(["7d"]);
  expect(written.searchParams.getAll("yards[]")).toEqual([
    "RTP Pick-A-Part - Hebron, KY",
  ]);
});

describe("default yard scope stays out of the URL", () => {
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

  test("the default search writes plain /search", () => {
    expect(rewrite("https://example.com/search")).toBe(
      "https://example.com/search",
    );
  });

  test("legacy self-service links keep self-service and drop the parameter", () => {
    const href = "https://example.com/search?yardTypes%5B%5D=self_service";
    expect(
      routing.stateMapping.routeToState(
        routing.router.parseURL({ location: new URL(href) }),
      ).vehicles?.refinementList,
    ).toEqual({ yardTypes: ["self_service"] });
    expect(rewrite(href)).toBe("https://example.com/search");
  });

  test("non-default yard choices stay in the URL", () => {
    for (const [href, expected] of [
      [
        "https://example.com/search?yardTypes=all",
        "https://example.com/search?yardTypes%5B%5D=all",
      ],
      [
        "https://example.com/search?yardTypes%5B%5D=full_service",
        "https://example.com/search?yardTypes%5B%5D=full_service",
      ],
      [
        "https://example.com/search?yardTypes%5B%5D=self_service&yardTypes%5B%5D=full_service",
        "https://example.com/search?yardTypes%5B%5D=self_service&yardTypes%5B%5D=full_service",
      ],
    ] as const)
      expect(rewrite(href)).toBe(expected);
  });

  test("an expression that owns its yard types writes no yard parameter", () => {
    const url = new URL("https://example.com/search?syntax=expression");
    url.searchParams.set("q", "yardType:full_service");
    const written = new URL(rewrite(url.href));
    expect(written.searchParams.has("yardTypes")).toBe(false);
    expect(written.searchParams.has("yardTypes[]")).toBe(false);
    expect(written.searchParams.get("q")).toBe("yardType:full_service");
  });
});

describe("search history writes", () => {
  function withBrowser(href: string, run: (writes: string[]) => void) {
    const previousWindow = Object.getOwnPropertyDescriptor(
      globalThis,
      "window",
    );
    const writes: string[] = [];
    const browser = {
      location: new URL(href),
      history: {
        state: null,
        pushState(_state: unknown, _title: string, url: string) {
          writes.push(`push ${url}`);
          browser.location = new URL(url);
        },
        replaceState(_state: unknown, _title: string, url: string) {
          writes.push(`replace ${url}`);
          browser.location = new URL(url);
        },
      },
    };
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: browser,
    });
    try {
      run(writes);
    } finally {
      if (previousWindow)
        Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }
  }

  test("rewriting a navigated URL for the same search replaces its entry", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, false, false);
    const canonical =
      "https://example.com/search?q=Volvo&minYear=1963&maxYear=2000&yardTypes%5B%5D=all";
    withBrowser(
      "https://example.com/search?q=Volvo&yardTypes=all&minYear=1963&maxYear=2000&sort=newest",
      (writes) => {
        routing.router.push(canonical);
        expect(writes).toEqual([`replace ${canonical}`]);
      },
    );
  });

  test("a different search still adds a history entry", () => {
    const routing = createSearchRouting(ALGOLIA_INDEX_NAME, false, false);
    const next = "https://example.com/search?q=Saab&yardTypes%5B%5D=all";
    withBrowser(
      "https://example.com/search?q=Volvo&yardTypes%5B%5D=all",
      (writes) => {
        routing.router.push(next);
        expect(writes).toEqual([`push ${next}`]);
      },
    );
  });
});
