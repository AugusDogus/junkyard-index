// The default search page: a clean URL, one toolbar row, and every other
// control inside Filters. Active choices show as removable chips.
import { afterAll, beforeAll, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Browser, Page } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";
import {
  bundleSharedSearchFixture,
  renderSharedSearchFixture,
} from "./fixtures/build-shared-search";

let browser: Browser;
let script: string;
let stylesheet: string;

beforeAll(async () => {
  [script, stylesheet] = await Promise.all([
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

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

async function open(
  page: Page,
  search: string,
  ready: "results" | "chips" = "results",
) {
  page.setDefaultTimeout(10_000);
  await page.route("http://shared-search.test/**", async (route) => {
    const url = new URL(route.request().url());
    const isScript = url.pathname === "/app.js";
    return route.fulfill({
      contentType: isScript ? "text/javascript" : "text/html",
      body: isScript ? script : await renderSharedSearchFixture(url.search),
    });
  });
  await page.goto(`http://shared-search.test/search${search}`);
  await page.addStyleTag({ content: stylesheet });
  // next/font defines the font in the app. The padding stands in for the site
  // header the sticky toolbar sits under, so the toolbar covers nothing.
  await page.addStyleTag({
    content: ':root{--font-chivo-mono:"Chivo Mono"}body{padding-top:6.375rem}',
  });
  await (
    ready === "results"
      ? page.getByRole("heading", { name: /^[\d,]+ vehicles?$/ })
      : page.getByRole("group", { name: "Active filters" })
  ).waitFor();
}

/** Lets pending router and nuqs URL writes land. */
async function settle(page: Page) {
  await page.waitForTimeout(500);
}

const urlSearch = (page: Page) => new URL(page.url()).search;

async function openFilters(page: Page) {
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("group", { name: "Arrival window" }).waitFor();
}

/** Phones edit filters in a drawer; close it to reach the page again. */
async function closeFilters(page: Page, width: number) {
  if (width < 768) {
    await page.getByRole("button", { name: "Show results" }).click();
    await page
      .getByRole("dialog", { name: "Filters" })
      .waitFor({ state: "detached" });
  }
}

for (const viewport of VIEWPORTS) {
  test(`the default search keeps a clean URL and starts results on the first screen: ${viewport.width}px`, async () => {
    const page = await createPage(browser, { viewport });
    try {
      await open(page, "");
      await settle(page);
      expect(urlSearch(page)).toBe("");
      expect(
        await page.getByRole("button", { name: /^Filters/ }).textContent(),
      ).toBe("Filters");
      for (const name of ["Arrival window", "Yard type", "Active filters"])
        expect(await page.getByRole("group", { name }).count()).toBe(0);
      expect(
        await page.getByRole("button", { name: "Advanced search" }).count(),
      ).toBe(0);
      expect(
        await page.getByRole("combobox", { name: "Distance radius" }).count(),
      ).toBe(0);
      expect(await page.getByText(/Results in \d+ ms/).count()).toBe(0);
      const firstCard = await page.locator("h3").first().boundingBox();
      expect(firstCard).not.toBeNull();
      expect((firstCard?.y ?? Infinity) < viewport.height).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await closePage(page);
    }
  }, 30_000);

  test(`filters move into the panel and show as removable chips: ${viewport.width}px`, async () => {
    const page = await createPage(browser, { viewport });
    try {
      await open(page, "");
      await openFilters(page);
      for (const name of ["Arrival window", "Yard type"])
        expect(await page.getByRole("group", { name }).count()).toBe(1);
      expect(
        await page.getByRole("combobox", { name: "Distance radius" }).count(),
      ).toBe(1);
      expect(
        await page.getByRole("button", { name: /^Advanced search/ }).count(),
      ).toBe(1);
      await page
        .getByRole("button", { name: "Last 7 days", exact: true })
        .click();
      await page
        .getByRole("checkbox", { name: "Full-service", exact: true })
        .click();
      await page.waitForFunction(() => {
        const params = new URL(location.href).searchParams;
        return (
          params.get("arrivalWindow[]") === "7d" &&
          params.getAll("yardTypes[]").length === 2
        );
      });
      await closeFilters(page, viewport.width);
      const chips = page.getByRole("group", { name: "Active filters" });
      await chips
        .getByRole("button", { name: "Remove Last 7 days", exact: true })
        .waitFor();
      expect(
        await chips
          .getByRole("button", {
            name: "Remove Full-service included",
            exact: true,
          })
          .count(),
      ).toBe(1);
      expect(
        await page
          .getByRole("button", { name: /^Filters/ })
          .first()
          .textContent(),
      ).toBe("Filters(2)");
      await chips
        .getByRole("button", { name: "Remove Last 7 days", exact: true })
        .click();
      await page.waitForFunction(
        () => !new URL(location.href).searchParams.has("arrivalWindow[]"),
      );
      await settle(page);
      expect(
        await chips.getByRole("button", { name: /^Remove / }).count(),
      ).toBe(1);
      await chips
        .getByRole("button", { name: "Clear all", exact: true })
        .click();
      await page.waitForFunction(() => location.search === "");
      await settle(page);
      expect(urlSearch(page)).toBe("");
      expect(
        await page.getByRole("group", { name: "Active filters" }).count(),
      ).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await closePage(page);
    }
  }, 30_000);
}

test("legacy self-service links keep the default scope without a chip", async () => {
  const page = await createPage(browser);
  try {
    await open(page, "?yardTypes%5B%5D=self_service");
    expect(
      await page.getByRole("group", { name: "Active filters" }).count(),
    ).toBe(0);
    expect(
      await page.getByRole("button", { name: /^Filters/ }).textContent(),
    ).toBe("Filters");
    await openFilters(page);
    expect(
      await page
        .getByRole("checkbox", { name: "Self-service", exact: true })
        .getAttribute("aria-checked"),
    ).toBe("true");
  } finally {
    await closePage(page);
  }
}, 30_000);

test("the free New near me link lands on an arrival-filtered search", async () => {
  const page = await createPage(browser, {
    viewport: { width: 390, height: 844 },
  });
  try {
    // The homepage link carries no location, so the page asks for one.
    await open(
      page,
      "?arrivalWindow%5B%5D=7d&radius=50&fixtureGuest=1",
      "chips",
    );
    const chips = page.getByRole("group", { name: "Active filters" });
    for (const name of ["Remove Last 7 days", "Remove Within 50 mi"])
      await chips.getByRole("button", { name, exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Choose location", exact: true })
      .click();
    await page.getByRole("dialog", { name: "Distance Location" }).waitFor();
    await page.keyboard.press("Escape");
    // The arrival view opens from the drawer too, with the window selected.
    await openFilters(page);
    expect(
      await page
        .getByRole("button", { name: "Last 7 days", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  } finally {
    await closePage(page);
  }
}, 30_000);
