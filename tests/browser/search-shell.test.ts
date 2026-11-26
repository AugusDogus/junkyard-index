import { afterAll, beforeAll, expect, test } from "bun:test";
import { z } from "zod";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Browser, Page } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";
import {
  bundleSharedSearchFixture,
  renderSharedSearchFixture,
} from "./fixtures/build-shared-search";

const requestLogSchema = z.array(
  z.object({
    indexName: z.string(),
    params: z.object({
      query: z.string().optional(),
      hitsPerPage: z.number().optional(),
      page: z.number().optional(),
      aroundRadius: z.union([z.number(), z.literal("all")]).optional(),
      aroundLatLng: z.string().optional(),
      aroundLatLngViaIP: z.boolean().optional(),
    }),
  }),
);
async function requestLog(page: Page) {
  return requestLogSchema.parse(
    JSON.parse(
      await page.evaluate(
        () => document.documentElement.dataset.searchQueryLog ?? "[]",
      ),
    ),
  );
}

const analyticsLogSchema = z.array(
  z.object({
    event: z.string(),
    properties: z.record(z.string(), z.unknown()),
  }),
);
async function analyticsEvents(page: Page, event: string) {
  return analyticsLogSchema
    .parse(
      JSON.parse(
        await page.evaluate(
          () => document.documentElement.dataset.analyticsEvents ?? "[]",
        ),
      ),
    )
    .filter((entry) => entry.event === event);
}

let browser: Browser;
let script: string;
let stylesheet: string;

beforeAll(async () => {
  [script, stylesheet] = await Promise.all([
    bundleSharedSearchFixture("browser").then((output) => output.text()),
    Bun.file("src/styles/globals.css")
      .text()
      .then(
        async (source) =>
          (
            await postcss([tailwind()]).process(source, {
              from: "src/styles/globals.css",
            })
          ).css,
      ),
  ]);
  browser = await launchBrowser();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

async function open(
  query: string,
  width = 1440,
  height = 900,
  options: {
    /** A location preference already saved in this browser. */
    storedLocation?: { mode: "zip"; zipCode: string; lat: number; lng: number };
  } = {},
) {
  const page = await createPage(browser, { viewport: { width, height } });
  const html = await renderSharedSearchFixture(query);
  const { storedLocation } = options;
  if (storedLocation)
    await page.addInitScript((value) => {
      localStorage.setItem("junkyard-index:location-preference", value);
    }, JSON.stringify(storedLocation));
  await page.route("http://shared-search.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/search-key")
      return route.fulfill({
        json: {
          apiKey: "fixture-fetched-key",
          expiresInSeconds: 3600,
          // fixtureKeyTier=free: the server still cannot confirm the plan,
          // unless fixtureRenewedTier=full says the direct lookup now does.
          tier:
            query.includes("fixtureGuest=1") ||
            (query.includes("fixtureKeyTier=free") &&
              !query.includes("fixtureRenewedTier=full"))
              ? "free"
              : "full",
          // fixtureRenewedHidden=meeks: meeks was hidden after the page
          // rendered, so only a renewed key carries it.
          hiddenSources: query.includes("fixtureRenewedHidden=meeks")
            ? ["meeks"]
            : [],
        },
      });
    return route.fulfill({
      contentType: url.pathname === "/app.js" ? "text/javascript" : "text/html",
      body:
        url.pathname === "/app.js"
          ? script
          : // The padding stands in for the site header the toolbar sticks under.
            html.replace(
              "</head>",
              `<style>${stylesheet}body{padding-top:6.375rem}</style></head>`,
            ),
    });
  });
  // tRPC lookups the fixture does not seed go to this origin. Hold them
  // open for pending options, a pending plan or a checkout still
  // confirming; fail them otherwise.
  const holdLookups =
    query.includes("fixtureOptions=pending") ||
    query.includes("fixturePlan=pending") ||
    query.includes("subscription=success");
  await page.route("http://unused.test/**", (route) =>
    holdLookups ? undefined : route.abort(),
  );
  await page.route("https://wsrv.nl/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="gray"/></svg>',
    }),
  );
  await page.goto(`http://shared-search.test/search?${query}`);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  // Hydration answers the server's own query from the client cache, but a
  // signed-in page may still search as its plan resolves. Let those land,
  // until no search starts for 300 ms, before tests measure their own.
  let seen = -1;
  for (let quiet = 0; quiet < 6; ) {
    const count = (await requestLog(page)).length;
    quiet = count === seen ? quiet + 1 : 0;
    seen = count;
    await page.waitForTimeout(50);
  }
  return { page, html };
}

test("SSR sends one full visitor page with eager images and no teasers", async () => {
  const { page, html } = await open(
    "q=pagination&fixtureGuest=1&fixtureMobile=1",
    390,
    844,
  );
  try {
    expect(html).toContain("<img");
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain("Showing 24");
    expect(html).toContain('"hitsPerPage":24');
    expect(html).toContain('"attributesToHighlight":[]');
    expect(html).not.toContain('"objectID":"pagination-71"');
    expect(await page.locator("[inert]").count()).toBe(0);
    await page.getByRole("heading", { name: "1995 Pagination Car" }).waitFor();
    expect(await page.locator("[inert] a, [inert] button").count()).toBe(0);
    expect(
      await page.locator("h3").filter({ hasText: "Pagination Car" }).count(),
    ).toBe(24);
    expect(await page.locator("img").first().getAttribute("loading")).toBe(
      "eager",
    );
    expect(
      await page.getByRole("link", { name: "View inventory" }).count(),
    ).toBe(24);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("a person on the default page gets results after hydration without a server search", async () => {
  const userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const { page, html } = await open(
    `fixtureGuest=1&fixtureUserAgent=${encodeURIComponent(userAgent)}`,
  );
  try {
    expect(html).toContain('<meta name="fixture-server-searches" content="0">');
    expect(html).not.toContain("InstantSearchInitialResults");
    await page.getByRole("heading", { name: "2011 Toyota Venza" }).waitFor();
    expect(
      (await requestLog(page)).some(
        ({ params }) => (params.hitsPerPage ?? 0) > 0,
      ),
    ).toBe(true);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("a crawler's /search render has one H1 and an intro before hydration", async () => {
  const userAgent =
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  const { page, html } = await open(
    `fixtureGuest=1&fixtureUserAgent=${encodeURIComponent(userAgent)}`,
  );
  try {
    expect(html).toContain('<meta name="fixture-server-searches" content="0">');
    const body = html.slice(html.indexOf('<div id="root">'));
    expect(body.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(body).toMatch(/<h1[^>]*>Search salvage yard inventory<\/h1>/);
    expect(body).toContain(
      "Search live donor vehicles across salvage yard networks",
    );
    // Hydrated, the page keeps exactly one H1 with the same name.
    expect(await page.locator("h1").allTextContents()).toEqual([
      "Search salvage yard inventory",
    ]);
    // It sits in a landmark, since the search's <main> renders after it.
    expect(
      await page
        .getByRole("region", { name: "Search salvage yard inventory" })
        .locator("h1")
        .count(),
    ).toBe(1);
  } finally {
    await closePage(page);
  }
}, 30_000);

// Rendering crawlers such as Googlebot run scripts. Each search they ran
// would spend the shared monthly Algolia quota.
for (const query of ["q=toyota+venza", "", "sort=distance"]) {
  test(`a rendering crawler never searches after hydration: ${query || "default page"}`, async () => {
    const userAgent =
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
    const fixtureQuery = `${query}&fixtureGuest=1&fixtureUserAgent=${encodeURIComponent(userAgent)}`;
    const page = await createPage(browser);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(request.url()));
    try {
      const html = await renderSharedSearchFixture(fixtureQuery);
      await page.route("http://shared-search.test/**", (route) => {
        const url = new URL(route.request().url());
        return url.pathname === "/app.js"
          ? route.fulfill({ contentType: "text/javascript", body: script })
          : url.pathname === "/search"
            ? route.fulfill({ contentType: "text/html", body: html })
            : route.abort();
      });
      await page.route("http://unused.test/**", (route) => route.abort());
      await page.goto(`http://shared-search.test/search?${fixtureQuery}`);
      // Page load means the fixture has hydrated; give a search time to start.
      await page.waitForTimeout(1000);
      expect(await requestLog(page)).toEqual([]);
      expect(
        requests.filter((url) => url.includes("/api/") || /algolia/i.test(url)),
      ).toEqual([]);
      // It keeps the loading search a person sees before hydration.
      expect(await page.getByLabel("Loading search").count()).toBe(1);
      expect(await page.getByRole("searchbox").count()).toBe(0);
    } finally {
      await closePage(page);
    }
  }, 30_000);
}

test("a person taken for a crawler can start the search", async () => {
  const userAgent =
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
  const { page } = await open(
    `q=toyota+venza&fixtureGuest=1&fixtureUserAgent=${encodeURIComponent(userAgent)}`,
  );
  try {
    expect(await requestLog(page)).toEqual([]);
    await page.getByRole("button", { name: "Start search" }).click();
    await page.getByRole("heading", { name: "2011 Toyota Venza" }).waitFor();
    expect(
      (await requestLog(page)).some(
        ({ params }) => params.query === "toyota venza",
      ),
    ).toBe(true);
    // The started search keeps the page's one H1.
    expect(await page.locator("h1").allTextContents()).toEqual([
      "Search salvage yard inventory",
    ]);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("a server-rendered person search is not repeated by the browser after hydration", async () => {
  const userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const { page, html } = await open(
    `q=toyota+venza&fixtureGuest=1&fixtureUserAgent=${encodeURIComponent(userAgent)}`,
  );
  try {
    expect(html).toContain("InstantSearchInitialResults");
    expect(html).not.toContain(
      '<meta name="fixture-server-searches" content="0">',
    );
    await page.getByRole("heading", { name: "2011 Toyota Venza" }).waitFor();
    // Hydration answers the server's query from the client cache.
    await page.waitForTimeout(1000);
    expect(
      (await requestLog(page)).filter(
        ({ params }) =>
          params.query === "toyota venza" && (params.hitsPerPage ?? 0) > 0,
      ),
    ).toEqual([]);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("visitor pages include a free radius and stop after 24 results", async () => {
  // A radius applies only around an origin, here the shared URL's.
  const { page, html } = await open(
    "q=pagination&sort=distance&radius=100&lat=33.448&lng=-112.074&fixtureGuest=1",
  );
  try {
    expect(html).toContain('"aroundRadius":160934');
    expect(html).toContain('"aroundLatLng":"33.448, -112.074"');
    await page.getByRole("button", { name: /^Filters/ }).click();
    expect(
      await page
        .getByRole("combobox", { name: "Distance radius", exact: true })
        .inputValue(),
    ).toBe("100");
    await page.evaluate(() => {
      document.documentElement.dataset.searchQueryLog = "[]";
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page
      .getByRole("heading", {
        name: "Upgrade to Lite to see every result.",
        exact: true,
      })
      .waitFor();
    expect(
      (await requestLog(page)).filter(({ params }) => (params.page ?? 0) > 0),
    ).toEqual([]);
    expect(
      await page
        .getByRole("link", { name: /^View inventory for the / })
        .count(),
    ).toBe(24);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("a blocked search backend says yard pages still work, without vendor text", async () => {
  const { page } = await open("q=pagination&fixtureGuest=1");
  try {
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    await page.getByRole("searchbox").fill("blocked");
    await page.getByRole("searchbox").press("Enter");
    await page.getByText("Yard pages still work.").waitFor();
    expect(
      await page
        .getByRole("link", { name: "Browse yards" })
        .getAttribute("href"),
    ).toBe("/junkyards");
    expect(await page.getByText("Application is blocked").count()).toBe(0);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("filter options come from Turso without an Algolia facet query", async () => {
  const { page } = await open("q=toyota");
  try {
    await page.getByRole("heading", { name: "2011 Toyota Venza" }).waitFor();
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("button", { name: /^Make/ }).click();
    await page.getByRole("checkbox", { name: "Saab", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Salvage yard/ }).click();
    await page
      .getByRole("checkbox", { name: "Turso-only yard", exact: true })
      .waitFor();
    expect(
      (await requestLog(page)).filter(({ params }) => params.hitsPerPage === 0),
    ).toEqual([]);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("a signed-in free account stops after the first 24 results", async () => {
  const { page } = await open("q=pagination&fixturePlan=free");
  try {
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    await page.evaluate(() => {
      document.documentElement.dataset.searchQueryLog = "[]";
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page
      .getByRole("heading", {
        name: "Upgrade to Lite to see every result.",
        exact: true,
      })
      .waitFor();
    expect(
      await page.getByRole("link", { name: "Create Free Account" }).count(),
    ).toBe(0);
    expect(
      (await requestLog(page)).filter(({ params }) => (params.page ?? 0) > 0),
    ).toEqual([]);
    expect(
      await page.locator("h3").filter({ hasText: "Pagination Car" }).count(),
    ).toBe(24);
  } finally {
    await closePage(page);
  }
}, 30_000);

for (const [state, message] of [
  ["pending", "Loading filter suggestions…"],
  ["failed", "Filter suggestions could not load"],
] as const) {
  test(`filter bars say when their options are ${state}`, async () => {
    const { page } = await open(`q=toyota&fixtureOptions=${state}`);
    try {
      await page.getByRole("heading", { name: "2011 Toyota Venza" }).waitFor();
      await page.getByRole("button", { name: /^Filters/ }).click();
      await page.getByRole("button", { name: /^Make/ }).click();
      await page.getByText(message).waitFor();
      expect(
        await page.getByText("You can still type values to add them.").count(),
      ).toBe(0);
      if (state === "failed")
        await page
          .getByRole("button", { name: "Retry loading filters" })
          .waitFor();
    } finally {
      await closePage(page);
    }
  }, 30_000);
}

async function scrollToEnd(page: Page) {
  await page.evaluate(() => {
    document.documentElement.dataset.searchQueryLog = "[]";
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

for (const [label, query] of [
  ["a plan that is still loading", "q=pagination&fixturePlan=pending"],
  [
    "a just-paid account while checkout confirms",
    "q=pagination&fixturePlan=free&subscription=success",
  ],
] as const) {
  test(`${label} stays on the first page without an upgrade prompt`, async () => {
    const { page } = await open(query);
    try {
      await page
        .getByText("Showing 24 of 96 vehicles", { exact: true })
        .waitFor();
      await scrollToEnd(page);
      await page.waitForTimeout(500);
      expect(
        await page
          .getByRole("heading", {
            name: "Upgrade to Lite to see every result.",
          })
          .count(),
      ).toBe(0);
      expect(
        (await requestLog(page)).filter(({ params }) => (params.page ?? 0) > 0),
      ).toEqual([]);
      expect(
        await page.locator("h3").filter({ hasText: "Pagination Car" }).count(),
      ).toBe(24);
    } finally {
      await closePage(page);
    }
  }, 30_000);
}

test("a plan lookup that fails stays on the first page and asks for a refresh", async () => {
  const { page } = await open("q=pagination&fixturePlan=unavailable");
  try {
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    await scrollToEnd(page);
    await page
      .getByRole("heading", { name: "Your plan could not be confirmed." })
      .waitFor();
    expect(
      await page
        .getByRole("heading", { name: "Upgrade to Lite to see every result." })
        .count(),
    ).toBe(0);
    expect(
      (await requestLog(page)).filter(({ params }) => (params.page ?? 0) > 0),
    ).toEqual([]);
  } finally {
    await closePage(page);
  }
}, 30_000);

for (const [label, query, reason] of [
  ["a visitor", "q=pagination&fixtureGuest=1", "visitor"],
  ["a free account", "q=pagination&fixturePlan=free", "free_plan"],
  ["a plan still loading", "q=pagination&fixturePlan=pending", null],
  [
    "a checkout still confirming",
    "q=pagination&fixturePlan=free&subscription=success",
    null,
  ],
  ["a failed plan lookup", "q=pagination&fixturePlan=unavailable", null],
] as const) {
  test(`result_cap_reached for ${label}: ${reason ?? "not sent"}`, async () => {
    const { page } = await open(query);
    try {
      await page
        .getByText("Showing 24 of 96 vehicles", { exact: true })
        .waitFor();
      if (query.includes("fixturePlan=unavailable"))
        await page
          .getByRole("heading", { name: "Your plan could not be confirmed." })
          .waitFor();
      // Let the capped search's effects run before reading the events.
      await page.waitForTimeout(1000);
      const events = await analyticsEvents(page, "result_cap_reached");
      expect(events.map(({ properties }) => properties.cap_reason)).toEqual(
        reason === null ? [] : [reason],
      );
    } finally {
      await closePage(page);
    }
  }, 30_000);
}

test("the shipped client meters searches and page-view ends report them", async () => {
  const { page } = await open("q=pagination");
  try {
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight - innerHeight),
    );
    await page
      .getByText("Showing 48 of 96 vehicles", { exact: true })
      .waitFor();
    // A client navigation ends the page view through Next's hook.
    await page.evaluate(() => {
      const hook: unknown = Reflect.get(window, "fixtureRouterTransitionStart");
      if (typeof hook === "function") hook();
    });
    const [navigation] = await analyticsEvents(page, "search_queries_metered");
    expect(navigation?.properties).toMatchObject({ path: "/search" });
    expect(Number(navigation?.properties.requests)).toBeGreaterThanOrEqual(1);
    expect(Number(navigation?.properties.queries)).toBeGreaterThanOrEqual(1);
    // Hiding the page ends the next page view.
    await page.getByRole("searchbox").fill("pagination2");
    await page.getByRole("searchbox").press("Enter");
    await page.waitForFunction(
      () => new URL(location.href).searchParams.get("q") === "pagination2",
    );
    await page.waitForTimeout(300);
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    expect(await analyticsEvents(page, "search_queries_metered")).toHaveLength(
      2,
    );
  } finally {
    await closePage(page);
  }
}, 30_000);

for (const [label, query, key] of [
  ["a visitor", "q=pagination&fixtureGuest=1", "fixture-free-key"],
  ["a paid account", "q=pagination", "fixture-full-key"],
] as const) {
  test(`${label} searches with the key the server minted for its plan`, async () => {
    const { page } = await open(query);
    try {
      await page
        .getByText("Showing 24 of 96 vehicles", { exact: true })
        .waitFor();
      // Hydration serves the server's results, so search anew in the browser.
      await page.getByRole("searchbox").fill("pagination2");
      await page.getByRole("searchbox").press("Enter");
      await page.waitForFunction(
        () => (document.documentElement.dataset.searchRequests ?? "0") !== "0",
      );
      expect(
        await page.evaluate(
          () => document.documentElement.dataset.searchApiKey,
        ),
      ).toBe(key);
    } finally {
      await closePage(page);
    }
  }, 30_000);
}

test("a paid page whose key the server minted free stays on the first page", async () => {
  const { page } = await open("q=pagination&fixtureKeyTier=free");
  try {
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    await scrollToEnd(page);
    await page
      .getByRole("heading", { name: "Your plan could not be confirmed." })
      .waitFor();
    expect(
      (await requestLog(page)).filter(({ params }) => (params.page ?? 0) > 0),
    ).toEqual([]);
    expect(
      await page.locator("h3").filter({ hasText: "Pagination Car" }).count(),
    ).toBe(24);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("a just-paid page replaces its rendered free key and browses every page", async () => {
  const { page } = await open(
    "q=pagination&fixtureKeyTier=free&fixtureRenewedTier=full",
  );
  try {
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    // The paid key is fetched without a search; once it lands, the cap
    // lifts and scrolling loads the next page with it.
    const more = page.getByText("Showing 48 of 96 vehicles", { exact: true });
    for (
      let attempt = 0;
      attempt < 20 && (await more.count()) === 0;
      attempt++
    ) {
      await page.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight - innerHeight),
      );
      await page.waitForTimeout(250);
    }
    await more.waitFor();
    expect(
      await page.evaluate(() => document.documentElement.dataset.searchApiKey),
    ).toBe("fixture-fetched-key");
    expect(
      await page
        .getByRole("heading", { name: "Your plan could not be confirmed." })
        .count(),
    ).toBe(0);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("a blocked backend fails the search once without fetching a new key", async () => {
  const { page } = await open("q=pagination&fixtureGuest=1");
  const keyRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/search-key")
      keyRequests.push(request.url());
  });
  try {
    await page.getByRole("searchbox").fill("blocked");
    await page.getByRole("searchbox").press("Enter");
    await page.getByText("Yard pages still work.").waitFor();
    await page.waitForTimeout(500);
    // A blocked app or exhausted quota is not the key's fault.
    expect(keyRequests).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.dataset.blockedSearches,
      ),
    ).toBe("1");
  } finally {
    await closePage(page);
  }
}, 30_000);

test("a key Algolia refuses is replaced once and the search retried", async () => {
  const { page } = await open(
    "q=pagination&fixtureGuest=1&fixtureKey=rejected",
  );
  try {
    // Record if the search ever shows its error state, even briefly.
    await page.evaluate(() => {
      new MutationObserver(() => {
        if (
          document.body.innerText.includes("Search is temporarily unavailable")
        )
          document.documentElement.dataset.sawSearchError = "1";
      }).observe(document.body, { childList: true, subtree: true });
    });
    await page.getByRole("searchbox").fill("pagination2");
    await page.getByRole("searchbox").press("Enter");
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.searchApiKey === "fixture-fetched-key",
    );
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    expect(
      await page.evaluate(
        () => document.documentElement.dataset.rejectedSearches,
      ),
    ).toBe("1");
    await page.waitForTimeout(300);
    expect(
      await page.evaluate(
        () => document.documentElement.dataset.sawSearchError ?? null,
      ),
    ).toBeNull();
  } finally {
    await closePage(page);
  }
}, 30_000);

test("a renewed key that hides meeks filters the next search and drops it from the picker", async () => {
  const { page } = await open(
    "q=pagination&fixtureKey=rejected&fixtureRenewedHidden=meeks",
  );
  const openSourcesPicker = async () => {
    const picker = page.getByRole("button", { name: /^Inventory sources/ });
    if (!(await picker.isVisible()))
      await page.getByRole("button", { name: /^Filters/ }).click();
    await picker.click();
  };
  const meeksOption = () =>
    page.getByRole("checkbox", { name: "Meeks Pic-N-Pull", exact: true });
  const sentFilters = async (query: string) =>
    z
      .array(
        z.object({
          params: z.object({
            query: z.string().optional(),
            filters: z.string().optional(),
          }),
        }),
      )
      .parse(
        JSON.parse(
          await page.evaluate(
            () => document.documentElement.dataset.searchQueryLog ?? "[]",
          ),
        ),
      )
      .filter(({ params }) => params.query === query)
      .map(({ params }) => params.filters ?? "");
  const search = async (query: string) => {
    await page.getByRole("searchbox").fill(query);
    await page.getByRole("searchbox").press("Enter");
  };
  try {
    // The rendered key hides nothing, so the picker offers meeks.
    await openSourcesPicker();
    await meeksOption().waitFor();
    await page.keyboard.press("Escape");
    await meeksOption().waitFor({ state: "detached" });

    // Algolia refuses the rendered key; the renewed one hides meeks.
    await search("pagination2");
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.searchApiKey === "fixture-fetched-key",
    );
    // The retried search was built before the renewal.
    expect(await sentFilters("pagination2")).not.toContainEqual(
      expect.stringContaining('NOT source:"meeks"'),
    );

    await search("pagination3");
    await page.waitForFunction(() =>
      (document.documentElement.dataset.searchQueryLog ?? "").includes(
        '"query":"pagination3"',
      ),
    );
    const next = await sentFilters("pagination3");
    expect(next.length).toBeGreaterThan(0);
    for (const filters of next) expect(filters).toContain('NOT source:"meeks"');

    await openSourcesPicker();
    await page
      .getByRole("checkbox", { name: "Pick Your Part (PYP)", exact: true })
      .waitFor();
    expect(await meeksOption().count()).toBe(0);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("search loads and searches when the page arrives without a usable key", async () => {
  const errors: string[] = [];
  const { page } = await open("q=pagination&fixtureGuest=1&fixtureKey=expired");
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.getByRole("searchbox").fill("pagination2");
    await page.getByRole("searchbox").press("Enter");
    await page.waitForFunction(
      () =>
        document.documentElement.dataset.searchApiKey === "fixture-fetched-key",
    );
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    expect(errors).toEqual([]);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("signed-in pagination survives sort switches and rows do not overlap after resizing", async () => {
  const { page, html } = await open("q=pagination");
  try {
    // Check every painted frame, not one moment: a stale row size shows for
    // only a frame after each page appends, so a single read is a coin flip.
    await page.evaluate(() => {
      const overlaps: string[] = [];
      document.documentElement.dataset.rowOverlaps = "[]";
      const check = () => {
        const boxes = Array.from(
          document.querySelectorAll<HTMLElement>("[data-index]"),
          (row) => ({
            index: row.dataset.index,
            box: row.getBoundingClientRect(),
          }),
        ).sort((a, b) => a.box.top - b.box.top);
        boxes.forEach(({ index, box }, position) => {
          const previous = boxes[position - 1];
          if (previous && box.top < previous.box.bottom - 1) {
            overlaps.push(`row ${index} overlaps row ${previous.index}`);
            document.documentElement.dataset.rowOverlaps =
              JSON.stringify(overlaps);
          }
        });
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    expect(html).toContain('"hitsPerPage":24');
    expect(html).not.toContain('"objectID":"pagination-71"');
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight - innerHeight),
    );
    await page
      .getByText("Showing 48 of 96 vehicles", { exact: true })
      .waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("combobox", { name: /^Sort vehicles:/ }).click();
    await page
      .getByRole("option", { name: "Oldest First", exact: true })
      .click();
    await page.getByRole("heading", { name: "1900 Pagination Car" }).waitFor();
    await page.getByRole("combobox", { name: /^Sort vehicles:/ }).click();
    await page
      .getByRole("option", { name: "Newest First", exact: true })
      .click();
    await page.getByRole("heading", { name: "1995 Pagination Car" }).waitFor();
    await page
      .getByText("Showing 48 of 96 vehicles", { exact: true })
      .waitFor();
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight - innerHeight),
    );
    await page
      .getByText("Showing 72 of 96 vehicles", { exact: true })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight - innerHeight),
    );
    await page.getByText("96 vehicles", { exact: true }).last().waitFor();
    const overlap = await page.locator("[data-index]").evaluateAll((rows) => {
      const boxes = rows
        .map((row) => row.getBoundingClientRect())
        .sort((a, b) => a.top - b.top);
      return boxes.some(
        (box, index) =>
          index > 0 && box.top < (boxes[index - 1]?.bottom ?? 0) - 1,
      );
    });
    expect(overlap).toBe(false);
    // The monitor's callback for the next frame was queued first, so this read
    // includes the frame painted after the last page appended.
    expect(
      await page.evaluate(
        () =>
          new Promise<string | undefined>((resolve) =>
            requestAnimationFrame(() =>
              resolve(document.documentElement.dataset.rowOverlaps),
            ),
          ),
      ),
    ).toBe("[]");
  } finally {
    await closePage(page);
  }
}, 60_000);

test("a shared distance URL remains selected without opening a dialog", async () => {
  const { page } = await open("q=pagination&sort=distance&fixtureGuest=1");
  try {
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page
      .getByRole("button", { name: "Set location", exact: true })
      .waitFor();
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(new URL(page.url()).searchParams.get("sort")).toBe("distance");
    await page
      .getByRole("button", { name: "Set location", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    expect(new URL(page.url()).searchParams.get("sort")).toBe("distance");
  } finally {
    await closePage(page);
  }
}, 30_000);

test("the toolbar scrolls away on short screens with filters open", async () => {
  const { page } = await open("q=pagination", 844, 390);
  try {
    await page.getByRole("button", { name: /^Filters/ }).click();
    const toolbar = page.locator("main > div.sticky");
    expect(
      await toolbar.evaluate((element) => getComputedStyle(element).position),
    ).toBe("static");
    await page.evaluate(() => window.scrollTo(0, 600));
    const box = await toolbar.boundingBox();
    expect(box?.y).toBeLessThan(0);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("signed-in reload restores once and leaves Sort reachable after returning to the top", async () => {
  const { page } = await open("q=pagination");
  try {
    for (const count of [48, 72]) {
      await page.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight - innerHeight),
      );
      await page
        .getByText(`Showing ${count} of 96 vehicles`, { exact: true })
        .waitFor();
    }
    await page.evaluate(() => window.scrollTo(0, 6000));
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("h3")).some((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 0 && box.top < innerHeight;
      }),
    );
    const before = await page.evaluate(() => ({
      y: scrollY,
      vehicle: Array.from(document.querySelectorAll("h3")).find((element) => {
        const box = element.getBoundingClientRect();
        return box.top >= 0 && box.top < innerHeight;
      })?.textContent,
    }));
    expect(before.vehicle).toBeDefined();
    await page.reload();
    await page
      .getByText("Showing 72 of 96 vehicles", { exact: true })
      .waitFor();
    await page.waitForFunction(
      ({ y, vehicle }) =>
        Math.abs(scrollY - y) < 2 &&
        Array.from(document.querySelectorAll("h3")).find((element) => {
          const box = element.getBoundingClientRect();
          return box.top >= 0 && box.top < innerHeight;
        })?.textContent === vehicle,
      before,
    );
    const after = await page.evaluate(
      () =>
        Array.from(document.querySelectorAll("h3")).find((element) => {
          const box = element.getBoundingClientRect();
          return box.top >= 0 && box.top < innerHeight;
        })?.textContent,
    );
    expect(after).toBe(before.vehicle);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("combobox", { name: /^Sort vehicles:/ }).click();
    // Reproduce scroll lock changing the content width without a window
    // resize, which would close Radix Select before its options can be checked.
    await page.evaluate(() => {
      document.body.style.width = `${document.body.clientWidth - 15}px`;
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.evaluate(() => scrollY)).toBeLessThan(5);
    const oldest = page.getByRole("option", {
      name: "Oldest First",
      exact: true,
    });
    const box = await oldest.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(0);
    await oldest.click();
    await page.getByRole("heading", { name: "1900 Pagination Car" }).waitFor();
  } finally {
    await closePage(page);
  }
}, 45_000);

test("resizing a desktop visitor caps both the new query request and visible mobile results", async () => {
  const { page } = await open("q=pagination&fixtureGuest=1");
  try {
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("searchbox").fill("pagination2");
    await page.getByRole("searchbox").press("Enter");
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    const requests = (await requestLog(page))
      .filter(
        ({ params }) =>
          params.query === "pagination2" && (params.hitsPerPage ?? 0) > 0,
      )
      .map(({ params }) => params.hitsPerPage);
    expect(requests).toEqual([24]);
    expect(
      await page.locator("h3").filter({ hasText: "Pagination Car" }).count(),
    ).toBe(24);
    expect(await page.locator("[inert] a").count()).toBe(0);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("each scroll page sends exactly one Algolia search after SSR, including the hint count", async () => {
  const { page } = await open("q=pagination");
  try {
    for (const count of [48, 72]) {
      await page.evaluate(() => {
        document.documentElement.dataset.searchQueryLog = "[]";
      });
      await page.evaluate(() =>
        window.scrollTo(0, document.body.scrollHeight - innerHeight),
      );
      await page
        .getByText(`Showing ${count} of 96 vehicles`, { exact: true })
        .waitFor();
      const requests = await requestLog(page);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.params).toMatchObject({
        page: count / 24 - 1,
        hitsPerPage: 24,
      });
    }
  } finally {
    await closePage(page);
  }
}, 30_000);

for (const width of [1440, 390]) {
  test(`unknown viewport SSR and hydration keep the 24-record visitor cap at ${width}px`, async () => {
    const { page, html } = await open(
      "q=pagination&fixtureGuest=1",
      width,
      844,
    );
    try {
      expect(html).toContain('"hitsPerPage":24');
      expect(html).not.toContain('"objectID":"pagination-71"');
      await page
        .getByText("Showing 24 of 96 vehicles", { exact: true })
        .waitFor();
      expect(
        (await requestLog(page))
          .filter(({ params }) => (params.hitsPerPage ?? 0) > 0)
          .every(({ params }) => params.hitsPerPage === 24),
      ).toBe(true);
      const serverPage = await createPage(browser, {
        viewport: { width, height: 844 },
        javaScriptEnabled: false,
      });
      try {
        await serverPage.route("https://wsrv.nl/**", (route) => route.abort());
        await serverPage.setContent(
          html.replace("</head>", `<style>${stylesheet}</style></head>`),
          { waitUntil: "domcontentloaded" },
        );
        const serverBox = await serverPage.locator("main").boundingBox();
        const hydratedBox = await page.locator("main").boundingBox();
        expect(serverBox).not.toBeNull();
        expect(hydratedBox).not.toBeNull();
        if (serverBox && hydratedBox)
          expect(Math.abs(serverBox.height - hydratedBox.height)).toBeLessThan(
            1,
          );
      } finally {
        await closePage(serverPage);
      }
    } finally {
      await closePage(page);
    }
  }, 30_000);
}

// Algolia bills each HTTP call, so these count calls (not inner queries)
// from the action until no call has started for `quietMs`.
async function searchCallsDuring(
  page: Page,
  action: () => Promise<void>,
  quietMs = 600,
) {
  const calls = async () =>
    Number(
      await page.evaluate(
        () => document.documentElement.dataset.searchRequests ?? "0",
      ),
    );
  const before = await calls();
  await page.evaluate(() => {
    document.documentElement.dataset.searchQueryLog = "[]";
  });
  await action();
  let seen = await calls();
  for (let quiet = 0; quiet < quietMs; quiet += 50) {
    await page.waitForTimeout(50);
    const now = await calls();
    if (now !== seen) {
      seen = now;
      quiet = 0;
    }
  }
  return { calls: seen - before, requests: await requestLog(page) };
}

const phoenixZip = {
  mode: "zip",
  zipCode: "85001",
  lat: 33.448,
  lng: -112.074,
} as const;

async function pickSort(page: Page, name: string) {
  await page.getByRole("combobox", { name: /^Sort vehicles:/ }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

test("switching into and out of Distance with a saved location sends one search each", async () => {
  const { page } = await open("q=pagination", 1440, 900, {
    storedLocation: phoenixZip,
  });
  try {
    const toDistance = await searchCallsDuring(page, () =>
      pickSort(page, "Distance (Nearest)"),
    );
    expect(toDistance.calls).toBe(1);
    expect(toDistance.requests[0]?.params).toMatchObject({
      aroundLatLng: "33.448, -112.074",
    });
    const toOldest = await searchCallsDuring(page, () =>
      pickSort(page, "Oldest First"),
    );
    expect(toOldest.calls).toBe(1);
    expect(toOldest.requests[0]?.params.aroundLatLng).toBeUndefined();
  } finally {
    await closePage(page);
  }
}, 30_000);

test("saving an approximate location for Distance sends one search", async () => {
  const { page } = await open("q=pagination&fixtureGuest=1");
  try {
    await pickSort(page, "Distance (Nearest)");
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    const save = await searchCallsDuring(page, async () => {
      await dialog.getByRole("button", { name: /Save location/ }).click();
      await dialog.waitFor({ state: "detached" });
    });
    expect(save.calls).toBe(1);
    expect(save.requests[0]?.params.aroundLatLngViaIP).toBe(true);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("keyboard steps on the Year slider search once, for the year they stop on", async () => {
  const { page } = await open("q=volvo&yardTypes=all");
  try {
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("button", { name: "Year", exact: true }).click();
    const latest = page.getByRole("slider").nth(1);
    const startYear = Number(await latest.getAttribute("aria-valuenow"));
    await latest.focus();
    const steps = await searchCallsDuring(
      page,
      async () => {
        for (let step = 0; step < 5; step++)
          await page.keyboard.press("ArrowLeft");
      },
      1200,
    );
    expect(steps.calls).toBe(1);
    expect(new URL(page.url()).searchParams.get("maxYear")).toBe(
      String(startYear - 5),
    );
  } finally {
    await closePage(page);
  }
}, 30_000);

test("a radius chosen before any location is set does not search", async () => {
  const { page } = await open("q=volvo&yardTypes=all");
  try {
    await page.getByRole("button", { name: /^Filters/ }).click();
    const radius = page.getByRole("combobox", { name: "Distance radius" });
    const change = await searchCallsDuring(page, async () => {
      await radius.selectOption("50");
      await radius.selectOption("100");
    });
    expect(change.calls).toBe(0);
    expect(new URL(page.url()).searchParams.get("radius")).toBe("100");
  } finally {
    await closePage(page);
  }
}, 30_000);

test("Clear all with a radius but no location still searches the cleared filters", async () => {
  const { page } = await open("q=volvo&yardTypes=all&minYear=2005&radius=50");
  try {
    const clear = await searchCallsDuring(page, () =>
      page
        .getByRole("button", { name: "Clear all", exact: true })
        .first()
        .click(),
    );
    expect(new URL(page.url()).searchParams.get("radius")).toBeNull();
    expect(clear.calls).toBe(1);
  } finally {
    await closePage(page);
  }
}, 30_000);
