// Run with `bun test tests/browser/shared-search.test.ts` after installing Playwright Chromium.
import { afterAll, beforeAll, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Browser } from "playwright-core";
import {
  bundleSharedSearchFixture,
  renderSharedSearchFixture,
} from "./fixtures/build-shared-search";
import { closePage, createPage, launchBrowser } from "./browser-page";

let browser: Browser;
let script: string;
let html: string;
let stylesheet: string;

beforeAll(async () => {
  [html, script, stylesheet] = await Promise.all([
    renderSharedSearchFixture(),
    bundleSharedSearchFixture("browser").then((output) => output.text()),
    Bun.file("src/styles/globals.css")
      .text()
      .then(async (source) => {
        const result = await postcss([tailwind()]).process(source, {
          from: "src/styles/globals.css",
        });
        return result.css;
      }),
  ]);
  browser = await launchBrowser();
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

for (const ready of [true, false]) {
  test(`phone sort labels and options honor chronological readiness: ${ready}`, async () => {
    const page = await createPage(browser, {
      viewport: { width: 390, height: 844 },
    });
    try {
      await page.route("http://shared-search.test/**", async (route) => {
        const url = new URL(route.request().url());
        const isScript = url.pathname === "/app.js";
        return route.fulfill({
          contentType: isScript ? "text/javascript" : "text/html",
          body: isScript ? script : await renderSharedSearchFixture(url.search),
        });
      });
      await page.goto(
        `http://shared-search.test/search?q=toyota+venza&fixtureNewestReady=${ready ? "1" : "0"}`,
      );
      await page.addStyleTag({ content: stylesheet });
      await page.getByRole("heading", { name: "2010 Toyota Venza" }).waitFor();
      const initialName = ready
        ? "Sort vehicles: Newest (Newest First)"
        : "Sort vehicles: Relevance (Relevance)";
      const initial = page.getByRole("combobox", {
        name: initialName,
        exact: true,
      });
      await initial.waitFor();
      expect(await initial.locator('span[class="md:hidden"]').isVisible()).toBe(
        true,
      );
      expect(
        await initial.locator('span[class="hidden md:inline"]').isVisible(),
      ).toBe(false);
      await initial.click();
      expect(
        await page
          .getByRole("option", { name: "Newest First", exact: true })
          .count(),
      ).toBe(ready ? 1 : 0);
      await page
        .getByRole("option", { name: "Oldest First", exact: true })
        .click();
      const oldest = page.getByRole("combobox", {
        name: "Sort vehicles: Oldest (Oldest First)",
        exact: true,
      });
      await oldest.waitFor();
      expect(
        await oldest.locator('span[class="md:hidden"]').textContent(),
      ).toBe("Oldest");
      await oldest.click();
      await page
        .getByRole("option", { name: "Relevance", exact: true })
        .click();
      const relevance = page.getByRole("combobox", {
        name: "Sort vehicles: Relevance (Relevance)",
        exact: true,
      });
      await relevance.waitFor();
      expect(
        await relevance.locator('span[class="md:hidden"]').textContent(),
      ).toBe("Relevance");
      await page.waitForFunction(
        (ready) =>
          new URL(window.location.href).searchParams.get("sort") ===
          (ready ? "relevance" : null),
        ready,
      );
      if (ready) {
        await page.reload();
        await relevance.waitFor();
      }
    } finally {
      await closePage(page);
    }
  }, 15_000);
}

for (const scenario of [
  { name: "initial hydration", button: null, count: 1 },
  { name: "capabilities remount", button: "Reload capabilities", count: 1 },
  { name: "plan remount", button: "Switch plan", count: 2 },
]) {
  test(`shared search cards and count agree after ${scenario.name}`, async () => {
    const page = await createPage(browser);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.route("http://shared-search.test/**", (route) => {
        const { pathname } = new URL(route.request().url());
        // A plan change asks the server for a key minted for the new plan.
        if (pathname === "/api/search-key")
          return route.fulfill({
            json: {
              apiKey: "fixture-renewed-free-key",
              expiresInSeconds: 3600,
              tier: "free",
            },
          });
        const isScript = pathname === "/app.js";
        return route.fulfill({
          contentType: isScript ? "text/javascript" : "text/html",
          body: isScript ? script : html,
        });
      });
      await page.goto(
        "http://shared-search.test/search?q=toyota+venza&states=Alabama",
      );
      await page.getByRole("heading", { name: "2010 Toyota Venza" }).waitFor();
      if (scenario.button) {
        const previous = await page.evaluate(() =>
          Number(document.documentElement.dataset.searchRequests ?? 0),
        );
        await page
          .getByRole("button", { name: scenario.button, exact: true })
          .click();
        await page.waitForFunction(
          (previous) =>
            Number(document.documentElement.dataset.searchRequests ?? 0) >
            previous,
          previous,
        );
        // Let React commit the response and the virtualized rows after remounting.
        await page.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        // Searches move to a key for the plan the page now shows. A search
        // sent before the click may still land with the old key, so wait
        // for the key rather than for any search.
        await page.waitForFunction(
          (key) => document.documentElement.dataset.searchApiKey === key,
          scenario.button === "Switch plan"
            ? "fixture-renewed-free-key"
            : "fixture-full-key",
        );
      }
      expect(await page.getByRole("searchbox").inputValue()).toBe(
        "toyota venza",
      );
      expect(
        await page
          .getByText(
            `${scenario.count} ${scenario.count === 1 ? "vehicle" : "vehicles"}`,
            { exact: true },
          )
          .count(),
      ).toBeGreaterThan(0);
      expect(
        await page.getByRole("heading", { name: "2010 Toyota Venza" }).count(),
      ).toBe(1);
      expect(
        await page.getByRole("heading", { name: "2012 Ford Focus" }).count(),
      ).toBe(0);
      expect(
        await page.getByRole("heading", { name: "2011 Toyota Venza" }).count(),
      ).toBe(scenario.count - 1);
      expect(errors).toEqual([]);
    } finally {
      await closePage(page);
    }
  }, 15_000);
}

for (const scenario of [
  { query: "(", extra: "", count: 1 },
  { query: "make:Toyota", extra: "&fixtureGuest=1", count: 2 },
  { query: "Toyota OR Ford", extra: "&fixtureBooleanReady=0", count: 1 },
]) {
  test(`rejected shared expression can be edited and submitted: ${scenario.query}${scenario.extra}`, async () => {
    const page = await createPage(browser);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.route("http://shared-search.test/**", async (route) => {
        const url = new URL(route.request().url());
        const isScript = url.pathname === "/app.js";
        return route.fulfill({
          contentType: isScript ? "text/javascript" : "text/html",
          body: isScript ? script : await renderSharedSearchFixture(url.search),
        });
      });
      await page.goto(
        `http://shared-search.test/search?q=${encodeURIComponent(scenario.query)}&syntax=expression&states%5B%5D=Alabama${scenario.extra}`,
      );
      await page.getByRole("alert").waitFor();
      expect(await page.getByRole("searchbox").inputValue()).toBe(
        scenario.query,
      );
      if (scenario.extra === "&fixtureGuest=1") {
        expect(await page.getByRole("link", { name: "Sign in" }).count()).toBe(
          1,
        );
        expect(
          await page.getByRole("link", { name: "See plans" }).count(),
        ).toBe(1);
      }
      await page.getByRole("searchbox").fill("toyota venza");
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.getByRole("heading", { name: "2010 Toyota Venza" }).waitFor();
      expect(new URL(page.url()).searchParams.getAll("states[]")).toEqual([
        "Alabama",
      ]);
      expect(
        await page
          .getByText(
            `${scenario.count} ${scenario.count === 1 ? "vehicle" : "vehicles"}`,
            { exact: true },
          )
          .count(),
      ).toBeGreaterThan(0);
      expect(
        await page.getByRole("heading", { name: "2012 Ford Focus" }).count(),
      ).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await closePage(page);
    }
  }, 15_000);
}

for (const width of [390, 1440]) {
  for (const query of ["Volvo 740", "Volvo"]) {
    test(`self-service recovery selects both types and survives reload: ${query}, ${width}px`, async () => {
      const page = await createPage(browser, {
        viewport: { width, height: 900 },
      });
      try {
        await page.route("http://shared-search.test/**", async (route) => {
          const url = new URL(route.request().url());
          const isScript = url.pathname === "/app.js";
          return route.fulfill({
            contentType: isScript ? "text/javascript" : "text/html",
            body: isScript
              ? script
              : await renderSharedSearchFixture(url.search),
          });
        });
        await page.goto(
          `http://shared-search.test/search?q=${encodeURIComponent(query)}`,
        );
        await page
          .getByRole("group", { name: "Yard type", exact: true })
          .waitFor();
        const self = page.getByRole("checkbox", {
          name: "Self-service",
          exact: true,
        });
        const full = page.getByRole("checkbox", {
          name: "Full-service",
          exact: true,
        });
        await page
          .getByRole("button", {
            name: "Show full-service results",
            exact: true,
          })
          .waitFor();
        expect(await self.getAttribute("aria-checked")).toBe("true");
        expect(await full.getAttribute("aria-checked")).toBe("false");
        expect(
          await page
            .getByText("+3 more vehicles at full-service yards.", {
              exact: false,
            })
            .count(),
        ).toBe(1);
        if (query === "Volvo 740")
          await page
            .getByRole("heading", { name: "No self-service matches" })
            .waitFor();
        else
          expect(
            await page
              .getByRole("heading", { name: /self-service matches/ })
              .count(),
          ).toBe(0);
        if (query === "Volvo") {
          const count = page.getByRole("heading", {
            name: "3 vehicles at self-service yards",
            exact: true,
          });
          await count.waitFor();
          const header = count.locator("xpath=../..");
          expect(
            await header
              .getByRole("button", { name: "Show full-service results" })
              .count(),
          ).toBe(1);
          expect(
            await header
              .getByRole("button", { name: "Show full-service results" })
              .getAttribute("data-slot"),
          ).toBe("button");
        }
        const showThem = page.getByRole("button", {
          name: "Show full-service results",
          exact: true,
        });
        await showThem.focus();
        await showThem.press("Enter");
        const expandedCount = query === "Volvo 740" ? 3 : 6;
        await page.waitForFunction(
          (count) =>
            document.activeElement?.textContent === `${count} vehicles`,
          expandedCount,
          { timeout: 3000 },
        );
        const focusedHeading = page.getByRole("heading", {
          name: `${expandedCount} vehicles`,
          exact: true,
        });
        expect(await focusedHeading.getAttribute("tabindex")).toBe("-1");
        const headingBox = await focusedHeading.boundingBox();
        expect(headingBox && headingBox.y > 300 && headingBox.y < 900).toBe(
          true,
        );
        await page
          .getByRole("status")
          .filter({
            hasText: `${expandedCount} vehicles found. Full-service yards included.`,
          })
          .waitFor();
        await page.waitForFunction(
          () =>
            new URL(location.href).searchParams.getAll("yardTypes[]").length ===
            2,
        );
        expect(await full.getAttribute("aria-checked")).toBe("true");
        expect(new URL(page.url()).searchParams.getAll("yardTypes[]")).toEqual([
          "self_service",
          "full_service",
        ]);
        await page.reload();
        await page
          .getByRole("heading", { name: "1987 Volvo 740" })
          .first()
          .waitFor();
        expect(await self.getAttribute("aria-checked")).toBe("true");
        expect(await full.getAttribute("aria-checked")).toBe("true");
        expect(
          await page
            .getByRole("button", {
              name: "Show full-service results",
              exact: true,
            })
            .count(),
        ).toBe(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await self.focus();
        await self.press("Space");
        await page.waitForFunction(() => {
          const types = new URL(location.href).searchParams.getAll(
            "yardTypes[]",
          );
          return types.length === 1 && types[0] === "full_service";
        });
        await page.reload();
        await page
          .getByRole("heading", { name: "1987 Volvo 740" })
          .first()
          .waitFor();
        expect(await self.getAttribute("aria-checked")).toBe("false");
        expect(await full.getAttribute("aria-checked")).toBe("true");
        expect(
          await page
            .getByRole("button", {
              name: "Show full-service results",
              exact: true,
            })
            .count(),
        ).toBe(0);
      } finally {
        await closePage(page);
      }
    }, 15_000);
  }
}

for (const width of [390, 1440]) {
  test(`all yards has a distinct visible selection and changes in one tap: ${width}px`, async () => {
    const page = await createPage(browser, {
      viewport: { width, height: 900 },
    });
    try {
      await page.route("http://shared-search.test/**", async (route) => {
        const url = new URL(route.request().url());
        const isScript = url.pathname === "/app.js";
        return route.fulfill({
          contentType: isScript ? "text/javascript" : "text/html",
          body: isScript ? script : await renderSharedSearchFixture(url.search),
        });
      });
      await page.goto("http://shared-search.test/search?q=Volvo&yardTypes=all");
      await page.addStyleTag({ content: stylesheet });
      const all = page.getByRole("button", {
        name: "All yards, including unclassified",
        exact: true,
      });
      await all.waitFor();
      expect(await all.getAttribute("aria-pressed")).toBe("true");
      expect(
        await page
          .getByRole("checkbox", { name: "Self-service", exact: true })
          .getAttribute("aria-checked"),
      ).toBe("false");
      expect(
        await page
          .getByRole("checkbox", { name: "Full-service", exact: true })
          .getAttribute("aria-checked"),
      ).toBe("false");
      await page
        .getByRole("heading", { name: "7 vehicles", exact: true })
        .waitFor();
      await page
        .getByRole("checkbox", { name: "Self-service", exact: true })
        .click();
      await page
        .getByRole("heading", {
          name: "3 vehicles at self-service yards",
          exact: true,
        })
        .waitFor();
      expect(await all.getAttribute("aria-pressed")).toBe("false");
      await page
        .getByRole("checkbox", { name: "Full-service", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "6 vehicles", exact: true })
        .waitFor();
      expect(await all.getAttribute("aria-pressed")).toBe("false");
      await all.click();
      await page
        .getByRole("heading", { name: "7 vehicles", exact: true })
        .waitFor();
      expect(await all.getAttribute("aria-pressed")).toBe("true");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await closePage(page);
    }
  }, 15_000);
}

test("expression-owned yard types are visible without an implicit self-service facet", async () => {
  const page = await createPage(browser);
  try {
    await page.route("http://shared-search.test/**", async (route) => {
      const url = new URL(route.request().url());
      const isScript = url.pathname === "/app.js";
      return route.fulfill({
        contentType: isScript ? "text/javascript" : "text/html",
        body: isScript ? script : await renderSharedSearchFixture(url.search),
      });
    });
    await page.goto(
      "http://shared-search.test/search?syntax=expression&q=yardType%3Afull_service",
    );
    await page
      .getByRole("heading", { name: "4 vehicles", exact: true })
      .waitFor();
    expect(
      await page
        .getByText("Yard types set in advanced search", { exact: true })
        .count(),
    ).toBe(1);
    expect(
      await page
        .getByRole("button", {
          name: "All yards, including unclassified",
          exact: true,
        })
        .count(),
    ).toBe(0);
    expect(
      await page
        .getByRole("checkbox", { name: "Self-service", exact: true })
        .count(),
    ).toBe(0);
    await page
      .getByRole("heading", { name: "1987 Volvo 740", exact: true })
      .first()
      .waitFor();
    expect(
      await page
        .getByRole("heading", { name: "1987 Volvo 740", exact: true })
        .count(),
    ).toBe(3);
    expect(
      new URL(page.url()).searchParams.getAll("yardTypes[]"),
    ).not.toContain("self_service");
  } finally {
    await closePage(page);
  }
}, 15_000);

test("settled counts replace the full-service announcement after another query", async () => {
  const page = await createPage(browser);
  try {
    await page.route("http://shared-search.test/**", async (route) => {
      const url = new URL(route.request().url());
      const isScript = url.pathname === "/app.js";
      return route.fulfill({
        contentType: isScript ? "text/javascript" : "text/html",
        body: isScript ? script : await renderSharedSearchFixture(url.search),
      });
    });
    await page.goto("http://shared-search.test/search?q=Volvo");
    const status = page
      .getByRole("status")
      .filter({ hasText: "3 vehicles found at self-service yards." });
    await status.waitFor();
    await page
      .getByRole("button", { name: "Show full-service results", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "6 vehicles found. Full-service yards included." })
      .waitFor();
    await page.getByRole("searchbox").fill("1990 toyota tacoma");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("heading", { name: "No vehicles found", exact: true })
      .waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: /^No vehicles found\.$/ })
      .waitFor();
    expect(
      await page
        .getByText("Try nearby years or remove a search term.", {
          exact: false,
        })
        .count(),
    ).toBe(1);
    await page.getByRole("searchbox").fill("ford focus");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page
      .getByRole("heading", { name: "1 vehicle", exact: true })
      .waitFor();
    await page
      .getByRole("status")
      .filter({ hasText: /^1 vehicle found\.$/ })
      .waitFor();
  } finally {
    await closePage(page);
  }
}, 15_000);

// A busy query's five-digit count and three-digit timing, in the site's
// monospace font: the fixture's own single digits fit any row.
for (const width of [360, 390, 1390]) {
  test(`the results header keeps a five-digit count and full-service hint compact: ${width}px`, async () => {
    const page = await createPage(browser, {
      viewport: { width, height: 900 },
    });
    try {
      await page.route("http://shared-search.test/**", async (route) => {
        const url = new URL(route.request().url());
        const isScript = url.pathname === "/app.js";
        return route.fulfill({
          contentType: isScript ? "text/javascript" : "text/html",
          body: isScript ? script : await renderSharedSearchFixture(url.search),
        });
      });
      await page.goto(
        "http://shared-search.test/search?q=Volvo&fixtureHitScale=4115&fixtureProcessingTimeMS=158",
      );
      await page.addStyleTag({ content: stylesheet });
      // next/font defines this in the app; without it text is proportional.
      await page.addStyleTag({
        content: ':root{--font-chivo-mono:"Chivo Mono"}',
      });
      const count = page.getByRole("heading", {
        name: "12,345 vehicles at self-service yards",
        exact: true,
      });
      await count.waitFor();
      const header = count.locator("xpath=../..");
      const button = header.getByRole("button", {
        name: "Show full-service results",
        exact: true,
      });
      await button.waitFor();
      const [headerBox, countBox, buttonBox] = await Promise.all([
        header.boundingBox(),
        count.boundingBox(),
        button.boundingBox(),
      ]);
      if (!headerBox || !countBox || !buttonBox)
        throw new Error("Expected the results header to be laid out");
      if (width === 1390) {
        expect(headerBox.height).toBeLessThanOrEqual(64);
        // The button shares the count's row instead of sitting below it.
        expect(buttonBox.y).toBeLessThan(countBox.y + countBox.height);
      } else {
        expect(headerBox.height).toBeLessThanOrEqual(120);
        expect(buttonBox.height).toBeGreaterThanOrEqual(44);
      }
      // The hint is text and an outline button, never a filled panel.
      expect(
        await header
          .getByText("+12,345 more vehicles at full-service yards.", {
            exact: false,
          })
          .evaluate((element) => {
            const fills = [element, element.parentElement].map(
              (node) => node && getComputedStyle(node).backgroundColor,
            );
            return fills.every((fill) => fill === "rgba(0, 0, 0, 0)");
          }),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await closePage(page);
    }
  }, 15_000);
}
