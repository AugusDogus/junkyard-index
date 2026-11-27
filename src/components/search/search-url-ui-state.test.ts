import { describe, expect, test } from "bun:test";
import type { IndexUiState } from "instantsearch.js";
import { ALGOLIA_INDEX_NAME } from "~/lib/constants";
import { SearchUrl } from "~/lib/search-url";
import {
  getSearchSortIndex,
  getSearchSortKey,
  SEARCH_SORT_OPTIONS,
} from "./search-routing";
import { SearchUrlUiState, type SearchUrlPolicy } from "./search-url-ui-state";
import { PAID_POLICY, SearchUrlTestFixtures } from "./search-url-test-fixtures";

const { read, write } = SearchUrlTestFixtures;
const FREE: SearchUrlPolicy = { ...PAID_POLICY, canUseAdvancedFilters: false };
const VIN_DISABLED: SearchUrlPolicy = {
  ...PAID_POLICY,
  vinPatternIndexReady: false,
};
const DEFAULT_YARDS = { yardTypes: ["self_service"] };

const VIN_URL = "https://example.com/search?q=1fadp3f29fl123456";

describe("search URL state", () => {
  test("retains a free radius when changing a query or sort", () => {
    const url = new URL(
      write("https://example.com/search?radius=50", FREE, {
        query: "2010-14 Ford F-150",
        sortBy: "vehicles_oldest",
        refinementList: DEFAULT_YARDS,
      }),
    );
    expect(url.searchParams.get("radius")).toBe("50");
    expect(url.searchParams.get("sort")).toBe("oldest");
  });

  test("round-trips both distance URL forms without conflating distance with newest", () => {
    for (const sort of ["distance", "vehicles_distance"]) {
      const href = `https://example.com/search?sort=${sort}`;
      expect(read(href)).toEqual({
        sortBy: "vehicles_distance",
        refinementList: { yardTypes: ["self_service"] },
      });
      expect(write(href)).toBe("https://example.com/search?sort=distance");
    }
    expect(getSearchSortIndex("distance")).toBe("vehicles_distance");
    expect(getSearchSortKey("vehicles_distance")).toBe("distance");
    expect(getSearchSortKey("vehicles")).toBe("relevance");
    expect(
      SEARCH_SORT_OPTIONS.find((option) => option.key === "distance")?.label,
    ).toBe("Distance (Nearest)");
  });

  test("keeps a ready VIN pattern out of Algolia's text query state", () => {
    expect(read(VIN_URL).query).toBeUndefined();
    expect(read(VIN_URL, VIN_DISABLED).query).toBe("1fadp3f29fl123456");
  });

  test("normalizes a ready VIN when rebuilding the URL", () => {
    expect(write(VIN_URL)).toBe(
      "https://example.com/search?q=1FADP3F29FL123456",
    );
  });

  test("maps stable sort keys and removes unknown sources", () => {
    expect(
      read(
        "https://example.com/search?sort=oldest&sources%5B%5D=pyp&sources%5B%5D=unknown",
      ),
    ).toEqual({
      sortBy: "vehicles_oldest",
      refinementList: { source: ["pyp"], yardTypes: ["self_service"] },
    });
  });

  test("omits untouched year bounds from the URL", () => {
    const maximumYear = new Date().getUTCFullYear() + 1;
    expect(
      write("https://example.com/search", PAID_POLICY, {
        sortBy: "vehicles_newest",
        range: { year: `1900:${maximumYear}` },
      }),
    ).toBe("https://example.com/search?yardTypes%5B%5D=all");
  });

  test("keeps only changed year bounds in the URL", () => {
    const maximumYear = new Date().getUTCFullYear() + 1;
    const written = (year: string) =>
      write("https://example.com/search", PAID_POLICY, {
        sortBy: "vehicles_newest",
        range: { year },
      });
    expect(written(`2000:${maximumYear}`)).toBe(
      "https://example.com/search?minYear=2000&yardTypes%5B%5D=all",
    );
    expect(written("1900:2020")).toBe(
      "https://example.com/search?maxYear=2020&yardTypes%5B%5D=all",
    );
  });

  test("removes restricted filters before building free-tier search state", () => {
    expect(
      read("https://example.com/search?q=civic&makes=Honda&minYear=2010", FREE),
    ).toEqual({
      query: "civic",
      sortBy: "vehicles_newest",
      range: { year: "2010:" },
      refinementList: { yardTypes: ["self_service"] },
    });
  });

  test("preserves locked filter URLs but lets authorized users clear them", () => {
    const href = "https://example.com/search?q=civic&makes=Honda";
    const uiState: IndexUiState = {
      query: "civic",
      sortBy: "vehicles_newest",
      refinementList: DEFAULT_YARDS,
    };
    expect(write(href, FREE, uiState)).toBe(href);
    expect(write(href, PAID_POLICY, uiState)).toBe(
      "https://example.com/search?q=civic",
    );
  });
});

test("retains expression syntax while editing and sorting results, clears it with the query", () => {
  const href = "https://example.com/search?q=make%3AVolvo&syntax=expression";
  expect(read(href).query).toBe("make:Volvo");
  const url = new URL(
    write(href, PAID_POLICY, {
      query: "make:Saab",
      sortBy: "vehicles_oldest",
      refinementList: DEFAULT_YARDS,
    }),
  );
  expect(url.searchParams.get("syntax")).toBe("expression");
  expect(url.searchParams.get("q")).toBe("make:Saab");
  expect(
    write(href, PAID_POLICY, {
      sortBy: "vehicles_newest",
      refinementList: DEFAULT_YARDS,
    }),
  ).toBe("https://example.com/search");
});

const COMMA_YARDS = [
  "RTP Pick-A-Part - Hebron, KY",
  "RTP Pick-A-Part - Lexington, KY",
];

test("round-trips comma-containing facets and multiple yards without a dictionary", () => {
  for (const yards of [
    COMMA_YARDS.slice(0, 1),
    COMMA_YARDS,
    ["Future Yard, Inc."],
  ]) {
    const refinementList = {
      make: ["Example, Motors", "Honda"],
      color: ["Blue, metallic"],
      state: ["Kentucky", "Ohio"],
      locationName: yards,
      source: ["row52", "pyp"],
      yardTypes: ["self_service", "full_service"],
    };
    const href = write("https://example.com/search", PAID_POLICY, {
      refinementList,
    });
    expect(read(href).refinementList).toEqual(refinementList);
  }
});

test("recovers legacy comma lists using longest known yard names", () => {
  const known = [...COMMA_YARDS, "RTP Pick-A-Part - Hebron"];
  for (const yards of [
    COMMA_YARDS.slice(0, 1),
    COMMA_YARDS,
    ["Other Yard", ...COMMA_YARDS],
  ]) {
    const params = new URLSearchParams({ yards: yards.join(",") });
    expect(
      read(`https://example.com/search?${params}`, PAID_POLICY, known)
        .refinementList?.locationName,
    ).toEqual(yards);
  }
});

test("preserves every repeated locked filter when editing a guest query", () => {
  const params = new URLSearchParams();
  for (const yard of COMMA_YARDS) params.append("yards[]", yard);
  for (const type of ["self_service", "full_service"])
    params.append("yardTypes[]", type);
  const url = new URL(write(`https://example.com/search?${params}`, FREE));
  expect(url.searchParams.getAll("yards[]")).toEqual(COMMA_YARDS);
  expect(url.searchParams.getAll("yardTypes[]")).toEqual([
    "self_service",
    "full_service",
  ]);
});

test("default and explicit newest routes select the chronological replica", () => {
  for (const sort of ["", "?sort=newest", "?sort=vehicles_newest"]) {
    expect(read(`https://example.com/search${sort}`)).toEqual({
      sortBy: "vehicles_newest",
      refinementList: { yardTypes: ["self_service"] },
    });
  }
  expect(getSearchSortKey("vehicles")).toBe("relevance");
  expect(getSearchSortIndex("relevance")).toBe("vehicles");
  const toUrl = (uiState: IndexUiState) =>
    SearchUrlUiState.fromUiState(uiState, PAID_POLICY, {}).url;
  expect(toUrl({ sortBy: "vehicles" })).toEqual({
    sort: "relevance",
    yardTypes: [],
  });
  // InstantSearch omits sortBy when the primary index is selected.
  expect(toUrl({})).toEqual({ sort: "relevance", yardTypes: [] });
});

test("uses honest relevance sorting until the chronological replica is ready", () => {
  for (const sort of [
    "",
    "?sort=newest",
    "?sort=vehicles_newest",
    "?sort=relevance",
  ]) {
    expect(
      read(`https://example.com/search${sort}`, {
        ...PAID_POLICY,
        newestSortReady: false,
      }),
    ).toEqual({
      sortBy: ALGOLIA_INDEX_NAME,
      refinementList: { yardTypes: ["self_service"] },
    });
  }
});

test("free arrival links retain repeated yard scope, year, and window", () => {
  const href =
    "https://example.com/search?arrivalWindow[]=7d&yards[]=RTP%20Pick-A-Part%20-%20Hebron,%20KY&sources[]=rtp&minYear=2000";
  expect(read(href, FREE)).toMatchObject({
    refinementList: {
      locationName: ["RTP Pick-A-Part - Hebron, KY"],
      source: ["rtp"],
      yardTypes: ["self_service"],
    },
    range: { year: "2000:" },
  });
  const written = new URL(write(href, FREE));
  expect(written.searchParams.getAll("arrivalWindow[]")).toEqual(["7d"]);
  expect(written.searchParams.getAll("yards[]")).toEqual([
    "RTP Pick-A-Part - Hebron, KY",
  ]);
});

test("plan-locked facets are left out of the write, so nuqs keeps them", () => {
  const current = SearchUrl.parse(
    new URLSearchParams("q=civic&makes[]=Honda&colors[]=Red"),
  );
  const { url, locked } = SearchUrlUiState.fromUiState(
    { query: "accord", refinementList: DEFAULT_YARDS },
    FREE,
    current,
  );
  expect(locked).toEqual(["makes", "colors", "states", "yards", "sources"]);
  const values = SearchUrl.writeValues(url, locked);
  for (const key of SearchUrl.facets) expect(key in values).toBe(false);
  expect(values.q).toBe("accord");
});

describe("default yard scope stays out of the URL", () => {
  test("the default search writes plain /search", () => {
    expect(write("https://example.com/search")).toBe(
      "https://example.com/search",
    );
  });

  test("legacy self-service links keep self-service and drop the parameter", () => {
    const href = "https://example.com/search?yardTypes%5B%5D=self_service";
    expect(read(href).refinementList).toEqual({ yardTypes: ["self_service"] });
    expect(write(href)).toBe("https://example.com/search");
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
      expect(write(href)).toBe(expected);
  });

  test("an expression that owns its yard types writes no yard parameter", () => {
    const url = new URL("https://example.com/search?syntax=expression");
    url.searchParams.set("q", "yardType:full_service");
    const written = new URL(write(url.href));
    expect(written.searchParams.has("yardTypes")).toBe(false);
    expect(written.searchParams.has("yardTypes[]")).toBe(false);
    expect(written.searchParams.get("q")).toBe("yardType:full_service");
  });
});

describe("history keys", () => {
  const policy: SearchUrlPolicy = {
    vinPatternIndexReady: false,
    canUseAdvancedFilters: false,
    newestSortReady: true,
  };
  const parse = (search: string) =>
    SearchUrl.parse(new URLSearchParams(search));

  test("a canonical rewrite of a navigated URL keeps the same results", () => {
    expect(
      SearchUrlUiState.searchKey(
        parse("q=Volvo&minYear=1963&maxYear=2000&yardTypes%5B%5D=all"),
        policy,
      ),
    ).toBe(
      SearchUrlUiState.searchKey(
        parse("q=Volvo&yardTypes=all&minYear=1963&maxYear=2000&sort=newest"),
        policy,
      ),
    );
  });

  test("a different search has different results", () => {
    expect(
      SearchUrlUiState.searchKey(parse("q=Saab&yardTypes%5B%5D=all"), policy),
    ).not.toBe(
      SearchUrlUiState.searchKey(parse("q=Volvo&yardTypes%5B%5D=all"), policy),
    );
  });

  test("editing only the query, including expression yard terms, is typing", () => {
    expect(
      SearchUrlUiState.typingKey(parse("q=toyota+v&states%5B%5D=Ohio"), policy),
    ).toBe(
      SearchUrlUiState.typingKey(parse("q=toyota&states%5B%5D=Ohio"), policy),
    );
    // The page keeps the expression's yard scope while typing, so the new
    // query writes it out.
    expect(
      SearchUrlUiState.typingKey(
        parse("q=make%3AFord&syntax=expression&yardTypes%5B%5D=all"),
        PAID_POLICY,
      ),
    ).toBe(
      SearchUrlUiState.typingKey(
        parse("q=yardType%3Afull_service&syntax=expression"),
        PAID_POLICY,
      ),
    );
    expect(
      SearchUrlUiState.typingKey(parse("q=toyota&sort=oldest"), policy),
    ).not.toBe(SearchUrlUiState.typingKey(parse("q=toyota"), policy));
  });
});

describe("searched key", () => {
  test("counts a refinement the URL no longer allows, so Back drops it", () => {
    // A free arrival link refines yards; Back to the URL without the window
    // must clear that refinement, though a free viewer cannot set one.
    const withoutWindow = SearchUrl.parse(
      new URLSearchParams("q=civic&yards[]=Fixture+yard"),
    );
    expect(
      SearchUrlUiState.searchedKey(
        SearchUrlUiState.toUiState(withoutWindow, FREE),
        FREE,
        withoutWindow,
      ),
    ).not.toBe(
      SearchUrlUiState.searchedKey(
        {
          query: "civic",
          sortBy: "vehicles_newest",
          refinementList: {
            locationName: ["Fixture yard"],
            yardTypes: ["self_service"],
          },
        },
        FREE,
        withoutWindow,
      ),
    );
  });

  test("reads the words InstantSearch searches, not a VIN in the URL", () => {
    const vin = SearchUrl.parse(new URLSearchParams("q=1FADP3F29FL123456"));
    const words: IndexUiState = {
      query: "civic",
      sortBy: "vehicles_newest",
      refinementList: DEFAULT_YARDS,
    };
    expect(SearchUrlUiState.searchedKey(words, PAID_POLICY, vin)).not.toBe(
      SearchUrlUiState.searchedKey(
        SearchUrlUiState.toUiState(vin, PAID_POLICY),
        PAID_POLICY,
        vin,
      ),
    );
  });
});
