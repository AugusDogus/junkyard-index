// Run with `bun test tests/browser/shared-search.test.ts` after installing Playwright Chromium.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright-core";
import {
  bundleSharedSearchFixture,
  renderSharedSearchFixture,
} from "./fixtures/build-shared-search";

let browser: Browser;
let script: string;
let html: string;

beforeAll(async () => {
  [html, script] = await Promise.all([
    renderSharedSearchFixture(),
    bundleSharedSearchFixture("browser").then((output) => output.text()),
  ]);
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

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
        `http://shared-search.test/search?q=${encodeURIComponent(scenario.query)}&syntax=expression&states=Alabama${scenario.extra}`,
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
      expect(new URL(page.url()).searchParams.get("states")).toBe("Alabama");
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
