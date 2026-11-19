// Run with `bun test tests/browser/shared-search.test.ts` after installing Playwright Chromium.
import { afterAll, beforeAll, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { chromium, type Browser } from "playwright-core";
import {
  bundleSharedSearchFixture,
  renderSharedSearchFixture,
} from "./fixtures/build-shared-search";

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
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

for (const ready of [true, false]) {
  test(`phone sort labels and options honor chronological readiness: ${ready}`, async () => {
    const page = await browser.newPage({
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
      await page.close();
    }
  }, 15_000);
}

for (const scenario of [
  { name: "initial hydration", button: null, count: 1 },
  { name: "capabilities remount", button: "Reload capabilities", count: 1 },
  { name: "plan remount", button: "Switch plan", count: 2 },
]) {
  test(`shared search cards and count agree after ${scenario.name}`, async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.route("http://shared-search.test/**", (route) => {
        const isScript = new URL(route.request().url()).pathname === "/app.js";
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
      }
      expect(await page.getByRole("searchbox").inputValue()).toBe(
        "toyota venza",
      );
      expect(
        await page
          .getByText(`${scenario.count} vehicles`, { exact: true })
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
      await page.close();
    }
  }, 15_000);
}

for (const scenario of [
  { query: "(", extra: "", count: 1 },
  { query: "make:Toyota", extra: "&fixtureGuest=1", count: 2 },
  { query: "Toyota OR Ford", extra: "&fixtureBooleanReady=0", count: 1 },
]) {
  test(`rejected shared expression can be edited and submitted: ${scenario.query}${scenario.extra}`, async () => {
    const page = await browser.newPage();
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
          .getByText(`${scenario.count} vehicles`, { exact: true })
          .count(),
      ).toBeGreaterThan(0);
      expect(
        await page.getByRole("heading", { name: "2012 Ford Focus" }).count(),
      ).toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 15_000);
}

for (const width of [390, 1440]) {
  for (const query of ["Volvo 740", "Volvo"]) {
    test(`self-service recovery selects both types and survives reload: ${query}, ${width}px`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
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
        const self = page.getByRole("button", {
          name: "Self-service",
          exact: true,
        });
        const full = page.getByRole("button", {
          name: "Full-service",
          exact: true,
        });
        await page
          .getByRole("button", { name: "Show them", exact: true })
          .waitFor();
        expect(await self.getAttribute("aria-pressed")).toBe("true");
        expect(await full.getAttribute("aria-pressed")).toBe("false");
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
        await page
          .getByRole("button", { name: "Show them", exact: true })
          .click();
        await page.waitForFunction(
          () =>
            new URL(location.href).searchParams.getAll("yardTypes[]").length ===
            2,
        );
        expect(await full.getAttribute("aria-pressed")).toBe("true");
        expect(new URL(page.url()).searchParams.getAll("yardTypes[]")).toEqual([
          "self_service",
          "full_service",
        ]);
        await page.reload();
        await page
          .getByRole("heading", { name: "1987 Volvo 740" })
          .first()
          .waitFor();
        expect(await self.getAttribute("aria-pressed")).toBe("true");
        expect(await full.getAttribute("aria-pressed")).toBe("true");
        expect(
          await page
            .getByRole("button", { name: "Show them", exact: true })
            .count(),
        ).toBe(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
      } finally {
        await page.close();
      }
    }, 15_000);
  }
}
