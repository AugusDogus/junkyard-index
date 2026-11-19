import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";
import {
  bundleSharedSearchFixture,
  renderSharedSearchFixture,
} from "./fixtures/build-shared-search";

let browser: Browser;
let script: string;
beforeAll(async () => {
  script = await (await bundleSharedSearchFixture("browser")).text();
  browser = await launchBrowser();
}, 30000);
afterAll(async () => {
  await browser?.close();
});

for (const width of [390, 1440]) {
  test(`free arrival chips retain newest, radius and history with one results request at ${width}px`, async () => {
    const page = await createPage(browser, {
      viewport: { width, height: 900 },
    });
    try {
      await page.route("http://shared-search.test/**", async (route) => {
        const url = new URL(route.request().url());
        return route.fulfill({
          contentType:
            url.pathname === "/app.js" ? "text/javascript" : "text/html",
          body:
            url.pathname === "/app.js"
              ? script
              : await renderSharedSearchFixture(url.search),
        });
      });
      await page.goto(
        "http://shared-search.test/search?q=arrivals&arrivalWindow[]=7d&radius=50&lat=33.448&lng=-112.074&fixtureGuest=1",
      );
      await page
        .getByRole("heading", { name: "2 vehicles", exact: true })
        .waitFor();
      const requests = () =>
        page.evaluate(() => {
          const log = JSON.parse(
            document.documentElement.dataset.searchQueryLog ?? "[]",
          );
          return log.filter(
            (request: { params?: { hitsPerPage?: number } }) =>
              request.params?.hitsPerPage === 24,
          );
        });
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const before = await requests();
      await page
        .getByRole("button", { name: "Last 24 hours", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "1 vehicle", exact: true })
        .waitFor();
      await page.waitForFunction(
        () =>
          new URL(window.location.href).searchParams.get("arrivalWindow[]") ===
          "24h",
      );
      const after = await requests();
      expect(after.length - before.length).toBe(1);
      expect(after.at(-1)).toMatchObject({
        indexName: "vehicles_newest",
        params: {
          aroundLatLng: "33.448, -112.074",
          aroundRadius: 80467,
          filters: expect.stringContaining("availableDateTs >="),
        },
      });
      expect(
        await page
          .getByRole("button", { name: "Last 24 hours", exact: true })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      expect(
        await page
          .getByRole("combobox", { name: "Distance radius", exact: true })
          .inputValue(),
      ).toBe("50");
      await page.goBack();
      await page
        .getByRole("heading", { name: "2 vehicles", exact: true })
        .waitFor();
      expect(
        await page
          .getByRole("button", { name: "Last 7 days", exact: true })
          .getAttribute("aria-pressed"),
      ).toBe("true");
      await page.reload();
      await page
        .getByRole("heading", { name: "2 vehicles", exact: true })
        .waitFor();
      expect(
        await page.getByRole("group", { name: "Arrival window" }).count(),
      ).toBe(1);
      const beforeRadius = await requests();
      await page
        .getByRole("combobox", { name: "Distance radius", exact: true })
        .selectOption("25");
      await page.waitForFunction(() => {
        const log = JSON.parse(
          document.documentElement.dataset.searchQueryLog ?? "[]",
        );
        return log.at(-1)?.params?.aroundRadius === 40234;
      });
      const afterRadius = await requests();
      expect(afterRadius.length - beforeRadius.length).toBe(1);
      expect(afterRadius.at(-1)).toMatchObject({
        indexName: "vehicles_newest",
      });
    } finally {
      await closePage(page);
    }
  }, 30000);
}

test("clearing year, arrival and radius filters spends one results request", async () => {
  const page = await createPage(browser);
  try {
    await page.route("http://shared-search.test/**", async (route) => {
      const url = new URL(route.request().url());
      return route.fulfill({
        contentType:
          url.pathname === "/app.js" ? "text/javascript" : "text/html",
        body:
          url.pathname === "/app.js"
            ? script
            : await renderSharedSearchFixture(url.search),
      });
    });
    await page.goto(
      "http://shared-search.test/search?q=arrivals&arrivalWindow[]=7d&radius=50&lat=33.448&lng=-112.074&minYear=2011&fixtureGuest=1",
    );
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .waitFor();
    const requestCount = () =>
      page.evaluate(
        () =>
          JSON.parse(
            document.documentElement.dataset.searchQueryLog ?? "[]",
          ).filter(
            (request: { params?: { hitsPerPage?: number } }) =>
              request.params?.hitsPerPage === 24,
          ).length,
      );
    const before = await requestCount();
    await page
      .getByRole("button", { name: "Clear filters", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "5 vehicles", exact: true })
      .waitFor();
    expect((await requestCount()) - before).toBe(1);
  } finally {
    await closePage(page);
  }
}, 30000);
