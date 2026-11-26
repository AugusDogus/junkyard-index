import { expect, test } from "bun:test";
import { z } from "zod";
import { renderSharedSearchFixture } from "../../../tests/browser/fixtures/build-shared-search";

test("visitor server payload contains exactly the 24 visible records and an honest prompt", async () => {
  const html = await renderSharedSearchFixture("q=pagination&fixtureGuest=1");
  const match = html.match(
    /window\[Symbol\.for\("InstantSearchInitialResults"\)\] = ([^<]+)/,
  );
  const initial = z
    .object({
      vehicles: z.object({
        results: z.array(
          z.object({
            hitsPerPage: z.number(),
            hits: z.array(z.object({ objectID: z.string() })),
          }),
        ),
      }),
    })
    .parse(JSON.parse(match?.[1] ?? "null"));
  expect(initial.vehicles.results[0]?.hitsPerPage).toBe(24);
  expect(initial.vehicles.results[0]?.hits).toHaveLength(24);
  expect(html).not.toContain('"objectID":"pagination-71"');
  expect(html).not.toContain("blur-sm");
  expect(html.indexOf("Want the rest of the results?")).toBeGreaterThan(
    html.indexOf("1972 Pagination Car"),
  );
}, 15_000);

for (const [query, bounds, years] of [
  ["2010-2014 Toyota Venza", "minYear=2011", [2011]],
  ["2010-14 Toyota Venza", "maxYear=2010", [2010]],
  ["2010..2014 Toyota Venza", "minYear=2015", []],
  ["2010 - 2014 Toyota Venza", "", [2010, 2011]],
  ["2011 Toyota Venza", "", [2011]],
] as const) {
  test(`free typed years intersect routed bounds: ${query} ${bounds}`, async () => {
    const html = await renderSharedSearchFixture(
      `q=${encodeURIComponent(query)}&fixtureGuest=1&${bounds}`,
    );
    const match = html.match(
      /window\[Symbol\.for\("InstantSearchInitialResults"\)\] = ([^<]+)/,
    );
    const initial = z
      .object({
        vehicles: z.object({
          results: z.array(
            z.object({
              query: z.string(),
              hits: z.array(z.object({ year: z.number() })),
            }),
          ),
        }),
      })
      .parse(JSON.parse(match?.[1] ?? "null"));
    expect(initial.vehicles.results[0]?.query).toBe("Toyota Venza");
    expect(initial.vehicles.results[0]?.hits.map((hit) => hit.year)).toEqual([
      ...years,
    ]);
  }, 15_000);
}

for (const sort of ["distance", "vehicles_distance"]) {
  test(`shared distance search hydrates its sort alias after querying the primary: ${sort}`, async () => {
    const html = await renderSharedSearchFixture(
      `q=toyota+venza&states=Alabama&sort=${sort}`,
    );
    const match = html.match(
      /window\[Symbol\.for\("InstantSearchInitialResults"\)\] = ([^<]+)/,
    );
    const initial = z
      .object({
        vehicles: z.object({
          state: z.object({ index: z.literal("vehicles_distance") }),
          results: z.array(
            z.object({
              index: z.literal("vehicles_distance"),
              hits: z.array(z.object({ objectID: z.string() })),
            }),
          ),
        }),
      })
      .parse(JSON.parse(match?.[1] ?? "null"));
    expect(initial.vehicles.results[0]?.hits).toMatchObject([
      { objectID: "venza-al" },
    ]);
  }, 15_000);
}

test("server results honor the shared query and state before hydration", async () => {
  const html = await renderSharedSearchFixture();
  const match = html.match(
    /window\[Symbol\.for\("InstantSearchInitialResults"\)\] = ([^<]+)/,
  );
  expect(match).not.toBeNull();
  const initial = z
    .object({
      vehicles: z.object({
        state: z.object({
          query: z.string().optional(),
          disjunctiveFacetsRefinements: z.record(z.array(z.string())),
        }),
        results: z.array(
          z.object({
            query: z.string(),
            nbHits: z.number(),
            hits: z.array(z.object({ objectID: z.string() })),
          }),
        ),
      }),
    })
    .parse(JSON.parse(match?.[1] ?? "null"));
  expect(initial.vehicles.state.query).toBe("toyota venza");
  expect(initial.vehicles.state.disjunctiveFacetsRefinements.state).toEqual([
    "Alabama",
  ]);
  expect(initial.vehicles.results[0]).toMatchObject({
    query: "toyota venza",
    nbHits: 1,
    hits: [{ objectID: "venza-al" }],
  });
}, 30_000);

for (const scenario of [
  { query: "(", extra: "", message: "Search could not run" },
  {
    query: "make:Toyota",
    extra: "&fixtureGuest=1",
    message: "Upgrade to use field conditions",
  },
  {
    query: "Toyota OR Ford",
    extra: "&fixtureBooleanReady=0",
    message: "Boolean OR search is temporarily unavailable",
  },
]) {
  test(`shared expression renders recovery instead of hanging: ${scenario.query}${scenario.extra}`, async () => {
    const html = await renderSharedSearchFixture(
      `q=${encodeURIComponent(scenario.query)}&syntax=expression${scenario.extra}`,
    );
    expect(html).toContain(scenario.message);
    expect(html).toContain('action="/search"');
    expect(html).toContain('name="q"');
    expect(html).not.toContain(
      'window[Symbol.for("InstantSearchInitialResults")]',
    );
  }, 15_000);
}

for (const [extra, index] of [
  ["", "vehicles_newest"],
  ["&fixtureNewestReady=0", "vehicles"],
] as const) {
  test(`default search waits for chronological readiness before querying ${index}`, async () => {
    const html = await renderSharedSearchFixture(`q=toyota+venza${extra}`);
    const match = html.match(
      /window\[Symbol\.for\("InstantSearchInitialResults"\)\] = ([^<]+)/,
    );
    const initial = z
      .object({
        vehicles: z.object({
          state: z.object({ index: z.string() }),
          results: z.array(z.object({ index: z.string() })),
        }),
      })
      .parse(JSON.parse(match?.[1] ?? "null"));
    expect(initial.vehicles.state.index).toBe(index);
    expect(initial.vehicles.results[0]?.index).toBe(index);
  }, 15_000);
}

for (const key of ["yards", "yards[]"]) {
  test(`shared comma yard is intact before hydration: ${key}`, async () => {
    const yard = "RTP Pick-A-Part - Hebron, KY";
    const params = new URLSearchParams({ [key]: yard });
    const html = await renderSharedSearchFixture(params.toString());
    const match = html.match(
      /window\[Symbol\.for\("InstantSearchInitialResults"\)\] = ([^<]+)/,
    );
    const initial = z
      .object({
        vehicles: z.object({
          state: z.object({
            disjunctiveFacetsRefinements: z.record(z.array(z.string())),
          }),
        }),
      })
      .parse(JSON.parse(match?.[1] ?? "null"));
    expect(
      initial.vehicles.state.disjunctiveFacetsRefinements.locationName,
    ).toEqual([yard]);
  }, 15_000);
}

const PERSON_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const GOOGLEBOT_USER_AGENT =
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function serverSearchCount(html: string) {
  const count = html.match(
    /<meta name="fixture-server-searches" content="(\d+)">/,
  )?.[1];
  if (count === undefined) throw new Error("Missing server search count");
  return Number(count);
}

test("a person's default page renders the skeleton without a server search", async () => {
  const html = await renderSharedSearchFixture(
    `fixtureGuest=1&utm_source=newsletter&fixtureUserAgent=${encodeURIComponent(PERSON_USER_AGENT)}`,
  );
  expect(serverSearchCount(html)).toBe(0);
  expect(html).toContain('aria-label="Loading search"');
  expect(html).not.toContain("InstantSearchInitialResults");
  expect(html).not.toContain("Toyota Venza");
}, 15_000);

// A crawler sees what a person's page shows before it hydrates: the same
// heading, intro and loading search, never a server search. Only the browser
// search that follows hydration is withheld (src/lib/search-server-render.ts).
for (const query of ["q=toyota", "utm_source=newsletter", "sort=distance"]) {
  test(`a crawler gets the loading search without a server search: ${query}`, async () => {
    const html = await renderSharedSearchFixture(
      `fixtureGuest=1&${query}&fixtureUserAgent=${encodeURIComponent(GOOGLEBOT_USER_AGENT)}`,
    );
    expect(serverSearchCount(html)).toBe(0);
    expect(html).toContain("Search salvage yard inventory");
    expect(html).toContain('aria-label="Loading search"');
    expect(html).not.toContain("InstantSearchInitialResults");
    expect(html).not.toContain("Toyota Venza");
  }, 15_000);
}

/** The rendered page, without the per-render arrival timestamp. */
function pageMarkup(html: string) {
  return html.replace(/ data-arrival-reference-time="\d+"/, "");
}

test("bare /search renders the same page for a crawler and a person", async () => {
  const render = (userAgent: string) =>
    renderSharedSearchFixture(
      `fixtureGuest=1&fixtureUserAgent=${encodeURIComponent(userAgent)}`,
    );
  const [crawler, person] = await Promise.all([
    render(GOOGLEBOT_USER_AGENT),
    render(PERSON_USER_AGENT),
  ]);
  expect(pageMarkup(crawler)).toBe(pageMarkup(person));
  expect(crawler).toContain("Search salvage yard inventory");
}, 15_000);

test("a signed-in person's specific search still renders results on the server", async () => {
  const html = await renderSharedSearchFixture(
    `q=toyota&fixtureUserAgent=${encodeURIComponent(PERSON_USER_AGENT)}`,
  );
  expect(serverSearchCount(html)).toBeGreaterThan(0);
  expect(html).toContain("InstantSearchInitialResults");
  expect(html).toContain("Toyota Venza");
}, 15_000);

// Scrapers that send a browser's user agent and no cookies loaded yard and
// model page links about 1,000 times a day, each a server search. A guest
// searches from the browser after hydration instead, so they spend nothing.
for (const query of [
  "q=toyota",
  "yards%5B%5D=Pick+Your+Part+-+Sun+Valley&sources%5B%5D=pyp&yardTypes=all&arrivalWindow%5B%5D=7d",
]) {
  test(`a guest's specific search renders the loading search without a server search: ${query}`, async () => {
    const html = await renderSharedSearchFixture(
      `fixtureGuest=1&${query}&fixtureUserAgent=${encodeURIComponent(PERSON_USER_AGENT)}`,
    );
    expect(serverSearchCount(html)).toBe(0);
    expect(html).toContain('aria-label="Loading search"');
    expect(html).not.toContain("InstantSearchInitialResults");
  }, 15_000);
}
