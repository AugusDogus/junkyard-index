import { describe, expect, test } from "bun:test";
import { SearchUrl } from "./search-url";
import { buildSearchUrl } from "./search-utils";
import { SearchUrlOrder } from "./search-url-order";

const COMMA_YARDS = [
  "RTP Pick-A-Part - Hebron, KY",
  "RTP Pick-A-Part - Lexington, KY",
];

// Outputs recorded from the URLSearchParams writer that `format` replaced.
// The router, saved-search links and alert emails all depend on these bytes.
const FORMATTED: [string, SearchUrl, string, URLSearchParams?][] = [
  ["nothing", {}, "/search"],
  ["query", { query: "Volvo 240" }, "/search?q=Volvo+240"],
  [
    "symbols in a query",
    { query: "a+b & c=d #1 50%" },
    "/search?q=a%2Bb+%26+c%3Dd+%231+50%25",
  ],
  [
    "expression syntax",
    { query: "make:Volvo AND year:1990..2000", expression: true },
    "/search?q=make%3AVolvo+AND+year%3A1990..2000&syntax=expression",
  ],
  ["expression without a query", { expression: true }, "/search"],
  ["arrival window", { arrivalWindow: "7d" }, "/search?arrivalWindow%5B%5D=7d"],
  [
    "nearby area",
    { area: { lat: 38.25, lng: -85.76 }, radius: 50 },
    "/search?lat=38.25&lng=-85.76&radius=50",
  ],
  ["radius without an origin", { radius: 25 }, "/search?radius=25"],
  [
    "facets with commas and repeats",
    {
      facets: {
        makes: ["Example, Motors", "Honda"],
        colors: ["Blue, metallic"],
        states: ["Kentucky", "Ohio"],
        yards: COMMA_YARDS,
        sources: ["row52", "pyp"],
      },
    },
    "/search?makes%5B%5D=Example%2C+Motors&makes%5B%5D=Honda&colors%5B%5D=Blue%2C+metallic&states%5B%5D=Kentucky&states%5B%5D=Ohio&yards%5B%5D=RTP+Pick-A-Part+-+Hebron%2C+KY&yards%5B%5D=RTP+Pick-A-Part+-+Lexington%2C+KY&sources%5B%5D=row52&sources%5B%5D=pyp",
  ],
  [
    "empty facet values",
    { facets: { makes: ["", "Honda"], colors: [] } },
    "/search?makes%5B%5D=Honda",
  ],
  [
    "year bounds",
    { minYear: 1975, maxYear: 1993 },
    "/search?minYear=1975&maxYear=1993",
  ],
  ["all yard types", { yardTypes: [] }, "/search?yardTypes%5B%5D=all"],
  ["implied self-service default", { yardTypes: ["self_service"] }, "/search"],
  [
    "full-service only",
    { yardTypes: ["full_service"] },
    "/search?yardTypes%5B%5D=full_service",
  ],
  [
    "both yard types",
    { yardTypes: ["self_service", "full_service"] },
    "/search?yardTypes%5B%5D=self_service&yardTypes%5B%5D=full_service",
  ],
  [
    "expression that owns its yard types",
    { query: "yardType:full_service", expression: true, yardTypes: [] },
    "/search?q=yardType%3Afull_service&syntax=expression",
  ],
  [
    "yard types an expression does not imply",
    {
      query: "yardType:full_service",
      expression: true,
      yardTypes: ["full_service"],
    },
    "/search?q=yardType%3Afull_service&syntax=expression&yardTypes%5B%5D=full_service",
  ],
  ["sort", { sort: "oldest" }, "/search?sort=oldest"],
  [
    "everything, in writing order",
    {
      sort: "year-desc",
      yardTypes: ["full_service"],
      maxYear: 1993,
      minYear: 1975,
      facets: { sources: ["pyp"], states: ["Kentucky"], makes: ["Volvo"] },
      query: "Volvo 240",
      radius: 100,
      area: { lat: 38.25, lng: -85.76 },
      arrivalWindow: "48h",
    },
    "/search?arrivalWindow%5B%5D=48h&lat=38.25&lng=-85.76&radius=100&q=Volvo+240&makes%5B%5D=Volvo&states%5B%5D=Kentucky&sources%5B%5D=pyp&minYear=1975&maxYear=1993&yardTypes%5B%5D=full_service&sort=year-desc",
  ],
  [
    "locked legacy and repeated facets",
    { query: "civic" },
    "/search?q=civic&makes=Honda%2CToyota&yards%5B%5D=RTP+Pick-A-Part+-+Hebron%2C+KY&yards%5B%5D=RTP+Pick-A-Part+-+Lexington%2C+KY",
    new URLSearchParams([
      ["makes", "Honda,Toyota"],
      ["q", "ignored"],
      ...COMMA_YARDS.map((yard): [string, string] => ["yards[]", yard]),
    ]),
  ],
  [
    "edited facets replace locked ones",
    { facets: { makes: ["Saab"] } },
    "/search?makes%5B%5D=Saab&states=Ohio",
    new URLSearchParams([
      ["makes", "Honda"],
      ["makes[]", "Volvo"],
      ["states", "Ohio"],
    ]),
  ],
];

describe("SearchUrl.format", () => {
  for (const [name, url, expected, locked] of FORMATTED)
    test(name, () => {
      expect(SearchUrl.format("/search", url, locked)).toBe(expected);
    });

  test("keeps the base of an absolute URL", () => {
    expect(
      SearchUrl.format("https://example.com/search", { query: "Saab" }),
    ).toBe("https://example.com/search?q=Saab");
  });
});

// Saved searches reach the URL through buildSearchUrl.
const SAVED: [
  string,
  string | null,
  Parameters<typeof buildSearchUrl>[1],
  string,
][] = [
  ["saved query", "Volvo", {}, "/search?q=Volvo&yardTypes%5B%5D=all"],
  [
    "saved full year range and newest sort",
    "Volvo",
    { yardTypes: [], minYear: 1900, maxYear: 2100, sortBy: "newest" },
    "/search?q=Volvo&maxYear=2100&yardTypes%5B%5D=all",
  ],
  [
    "saved self-service default",
    "Saab",
    { yardTypes: ["self_service"] },
    "/search?q=Saab",
  ],
  [
    "saved sort stored as an index name",
    "Volvo",
    { sortBy: "vehicles_oldest" },
    "/search?q=Volvo&yardTypes%5B%5D=all&sort=oldest",
  ],
  [
    "saved VIN pattern",
    null,
    { vinPattern: "yv4c*85**********", states: ["California"] },
    "/search?q=YV4C*85**********&states%5B%5D=California&yardTypes%5B%5D=all",
  ],
  [
    "saved VIN typed as the query",
    "1fadp3f29fl123456",
    {},
    "/search?q=1FADP3F29FL123456&yardTypes%5B%5D=all",
  ],
  [
    "saved expression",
    "",
    { expression: "make:Volvo AND year:1990..2000", sortBy: "oldest" },
    "/search?q=make%3AVolvo+AND+year%3A1990..2000&syntax=expression&yardTypes%5B%5D=all&sort=oldest",
  ],
  [
    "saved nearby search",
    "Volvo 240",
    {
      makes: ["Volvo"],
      salvageYards: COMMA_YARDS,
      yardTypes: ["full_service"],
      minYear: 1975,
      arrivalWindow: "48h",
      near: { lat: 38.25, lng: -85.76, radiusMiles: 100 },
      sortBy: "year-desc",
    },
    "/search?arrivalWindow%5B%5D=48h&lat=38.25&lng=-85.76&radius=100&q=Volvo+240&makes%5B%5D=Volvo&yards%5B%5D=RTP+Pick-A-Part+-+Hebron%2C+KY&yards%5B%5D=RTP+Pick-A-Part+-+Lexington%2C+KY&minYear=1975&yardTypes%5B%5D=full_service&sort=year-desc",
  ],
];

describe("saved search URLs", () => {
  for (const [name, query, filters, expected] of SAVED)
    test(name, () => {
      expect(buildSearchUrl(query, filters)).toBe(expected);
    });
});

describe("SearchUrl.parse", () => {
  const parse = (search: string, knownYardNames?: readonly string[]) =>
    SearchUrl.parse(new URLSearchParams(search), knownYardNames);

  test("reads every key the writer writes", () => {
    expect(
      parse(
        "arrivalWindow%5B%5D=48h&lat=38.25&lng=-85.76&radius=100&q=Volvo+240&makes%5B%5D=Volvo&states%5B%5D=Kentucky&sources%5B%5D=pyp&minYear=1975&maxYear=1993&yardTypes%5B%5D=full_service&sort=year-desc",
      ),
    ).toEqual({
      arrivalWindow: "48h",
      area: { lat: 38.25, lng: -85.76 },
      radius: 100,
      query: "Volvo 240",
      facets: { makes: ["Volvo"], states: ["Kentucky"], sources: ["pyp"] },
      minYear: 1975,
      maxYear: 1993,
      yardTypes: ["full_service"],
      sort: "year-desc",
    });
  });

  test("accepts legacy comma lists", () => {
    expect(parse("makes=Honda,Toyota&colors=Blue&colors=Red,Green")).toEqual({
      facets: { makes: ["Honda", "Toyota"], colors: ["Blue", "Red", "Green"] },
    });
  });

  test("recovers legacy comma lists using longest known yard names", () => {
    const known = [...COMMA_YARDS, "RTP Pick-A-Part - Hebron"];
    for (const yards of [
      COMMA_YARDS.slice(0, 1),
      COMMA_YARDS,
      ["Other Yard", ...COMMA_YARDS],
    ])
      expect(
        parse(String(new URLSearchParams({ yards: yards.join(",") })), known)
          .facets?.yards,
      ).toEqual(yards);
  });

  test("repeated keys win over legacy ones and drop empty values", () => {
    expect(parse("makes=Honda&makes%5B%5D=Saab&makes%5B%5D=").facets).toEqual({
      makes: ["Saab"],
    });
  });

  test("reads arrivalWindow and arrivalWindow[]", () => {
    expect(parse("arrivalWindow=7d").arrivalWindow).toBe("7d");
    expect(parse("arrivalWindow%5B%5D=24h").arrivalWindow).toBe("24h");
    expect(
      parse("arrivalWindow%5B%5D=24h&arrivalWindow=7d").arrivalWindow,
    ).toBe("24h");
    expect(parse("arrivalWindow%5B%5D=1y").arrivalWindow).toBeUndefined();
  });

  test("reads the yard scope", () => {
    expect(parse("").yardTypes).toBeUndefined();
    expect(parse("yardTypes=all").yardTypes).toEqual([]);
    expect(parse("yardTypes%5B%5D=all").yardTypes).toEqual([]);
    expect(parse("yardTypes%5B%5D=self_service").yardTypes).toEqual([
      "self_service",
    ]);
    expect(
      parse("q=yardType%3Afull_service&syntax=expression").yardTypes,
    ).toEqual([]);
  });

  test("an origin needs a supported radius", () => {
    expect(parse("lat=38.25&lng=-85.76")).toEqual({});
    expect(parse("lat=38.25&lng=-85.76&radius=30")).toEqual({});
    expect(parse("lat=91&lng=-85.76&radius=50")).toEqual({ radius: 50 });
    expect(parse("radius=25")).toEqual({ radius: 25 });
  });

  test("ignores values it cannot read", () => {
    expect(parse("minYear=abc&maxYear=&sort=&q=&syntax=lucene")).toEqual({});
  });

  test("keeps expression syntax", () => {
    expect(parse("q=make%3AVolvo&syntax=expression")).toEqual({
      query: "make:Volvo",
      expression: true,
    });
  });
});

describe("SearchUrl round trips", () => {
  for (const [name, , expected, locked] of FORMATTED)
    if (!locked)
      test(name, () => {
        const parsed = SearchUrl.parse(
          new URL(expected, "https://example.com").searchParams,
        );
        expect(SearchUrl.format("/search", parsed)).toBe(expected);
      });

  test("canonical values read back unchanged", () => {
    const url: SearchUrl = {
      arrivalWindow: "48h",
      area: { lat: 38.25, lng: -85.76 },
      radius: 100,
      query: "make:Volvo",
      expression: true,
      facets: { makes: ["Example, Motors", "Honda"], yards: COMMA_YARDS },
      minYear: 1975,
      maxYear: 1993,
      yardTypes: ["self_service", "full_service"],
      sort: "oldest",
    };
    expect(
      SearchUrl.parse(
        new URL(SearchUrl.format("/search", url), "https://example.com")
          .searchParams,
      ),
    ).toEqual(url);
  });

  for (const [name, query, filters, expected] of SAVED)
    test(name, () => {
      const parsed = SearchUrl.parse(
        new URL(expected, "https://example.com").searchParams,
      );
      expect(SearchUrl.format("/search", parsed)).toBe(
        buildSearchUrl(query, filters),
      );
    });
});

describe("SearchUrlOrder", () => {
  test("lists every key in the order format writes them", () => {
    const urlKeys: Partial<Record<string, string>> = SearchUrl.urlKeys;
    const keys: readonly string[] = SearchUrlOrder.keys;
    expect([...keys]).toEqual(
      Object.keys(SearchUrl.parsers).map((key) => urlKeys[key] ?? key),
    );
  });

  test("puts a nuqs write back in format order and keeps other keys after", () => {
    // nuqs deletes and appends each list it writes, so lists drift to the end.
    const written = new URLSearchParams(
      "utm_source=x&q=Volvo&sort=oldest&makes[]=Saab&arrivalWindow[]=7d&yardTypes[]=all",
    );
    expect(SearchUrlOrder.apply(written).toString()).toBe(
      new URLSearchParams(
        "arrivalWindow[]=7d&q=Volvo&makes[]=Saab&yardTypes[]=all&sort=oldest&utm_source=x",
      ).toString(),
    );
  });
});

describe("SearchUrl.load on server search params", () => {
  test("reads Next's repeated and legacy keys as the browser does", () => {
    const values = SearchUrl.load({
      q: "Volvo",
      "makes[]": ["Saab", "Volvo"],
      yards: "RTP Pick-A-Part - Hebron, KY",
      radius: "50",
      lat: "38.25",
      lng: "-85.76",
    });
    expect(values.makes).toEqual(["Saab", "Volvo"]);
    expect(values.legacyYards).toEqual(["RTP Pick-A-Part - Hebron, KY"]);
    expect(SearchUrl.fromValues(values)).toEqual(
      SearchUrl.parse(
        new URLSearchParams(
          "q=Volvo&makes[]=Saab&makes[]=Volvo&yards=RTP+Pick-A-Part+-+Hebron%2C+KY&radius=50&lat=38.25&lng=-85.76",
        ),
      ),
    );
  });

  test("ignores a radius outside the offered choices", () => {
    expect(SearchUrl.load({ radius: "33" }).radius).toBeNull();
  });
});
