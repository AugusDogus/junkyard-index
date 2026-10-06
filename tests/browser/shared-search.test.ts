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
