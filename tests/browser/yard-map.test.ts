import { afterAll, beforeAll, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Browser, Page } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";

let browser: Browser;
let script: string;
let stylesheet: string;

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/yard-map.tsx"],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const output = build.outputs[0];
  if (!build.success || !output) throw new Error(build.logs.join("\n"));
  script = await output.text();
  stylesheet = (
    await postcss([tailwind()]).process(
      await Bun.file("src/styles/globals.css").text(),
      { from: "src/styles/globals.css" },
    )
  ).css;
  browser = await launchBrowser();
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

const BLANK_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Serve the fixture app; `located` holds the visitor-location reply. */
async function serveFixture(page: Page, located: Promise<void>) {
  await page.route("http://yard-map.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/app.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (path === "/app.css")
      return route.fulfill({ contentType: "text/css", body: stylesheet });
    if (path === "/api/visitor-location") {
      await located;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ location: { lat: 25, lng: -97 } }),
      });
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`,
    });
  });
  await page.route(/^https?:\/\/(?!yard-map\.test)/, (route) => route.abort());
  // Blank tiles, so map moves that wait for their tiles can finish.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: BLANK_TILE }),
  );
}

test("the approximate location re-sorts the directory without losing scroll or focus", async () => {
  // Below the desktop width the location controls, and their account lookup,
  // stay unloaded, so only the IP location sorts the directory.
  const page = await createPage(browser, {
    viewport: { width: 390, height: 844 },
  });
  try {
    page.setDefaultTimeout(5_000);
    let sendLocation = () => {};
    const located = new Promise<void>((resolve) => {
      sendLocation = resolve;
    });
    await serveFixture(page, located);
    await page.goto("http://yard-map.test/");

    await page.getByRole("button", { name: "Browse" }).click();
    const list = page.getByRole("list", { name: "Yard directory results" });
    await list.getByRole("button", { name: /^Yard 0\b/ }).focus();
    for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() =>
      document.activeElement?.textContent?.startsWith("Yard 5"),
    );
    // Marks this list element; a remounted directory would be a new one.
    const scrolled = await list.evaluate((element) => {
      element.setAttribute("data-before-location", "");
      return element.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);

    sendLocation();
    // Nearest the southern location, Yard 39 now leads the list.
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-posinset="1"]')
          ?.textContent?.startsWith("Yard 39") ?? false,
    );
    expect(
      await page.evaluate(() =>
        document.activeElement?.textContent?.startsWith("Yard 5"),
      ),
    ).toBe(true);
    // The same list, not back at the top. The virtualizer nudges the offset
    // by the difference between measured and estimated row heights above it.
    expect(
      await list.evaluate((element) => ({
        same: element.hasAttribute("data-before-location"),
        scrolled: element.scrollTop > 0,
      })),
    ).toEqual({ same: true, scrolled: true });
  } finally {
    await closePage(page);
  }
}, 20_000);

test("the URL keeps the open yard and view so Back and shared links return to them", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1280, height: 900 },
  });
  try {
    page.setDefaultTimeout(5_000);
    await serveFixture(page, Promise.resolve());
    await page.goto("http://yard-map.test/?at=40%2C-97%2C8&yard=pyp%3A10");

    // Restored as saved: the yard's card is open and the view is not moved.
    await page.getByRole("button", { name: "Close yard details" }).waitFor();
    await page
      .getByRole("button", {
        name: "Yard 10, Town, TX",
        exact: true,
        pressed: true,
      })
      .waitFor();
    await page.waitForTimeout(400);
    expect(new URL(page.url()).search).toBe("?at=40%2C-97%2C8&yard=pyp%3A10");

    // Closing the card keeps the view and drops only the yard.
    await page.getByRole("button", { name: "Close yard details" }).click();
    await page.waitForFunction(() => location.search === "?at=40%2C-97%2C8");

    // Picking a pin centers it at the same zoom and records both.
    await page
      .getByRole("button", { name: "Yard 11, Town, TX", exact: true })
      .click();
    await page.waitForFunction(
      () => location.search === "?at=39.5%2C-97%2C8&yard=pyp%3A11",
    );
  } finally {
    await closePage(page);
  }
}, 20_000);

test("overlapping yards form a group that zooms in to separate them", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1280, height: 900 },
  });
  try {
    page.setDefaultTimeout(5_000);
    await serveFixture(page, Promise.resolve());
    await page.goto("http://yard-map.test/");
    const groups = page.locator(".yard-map-cluster");
    await groups.first().waitFor();
    const pinsBefore = await page.locator(".yard-map-pin").count();
    expect(pinsBefore).toBeLessThan(40);

    await groups.first().click();
    await page.waitForFunction(
      (before) => document.querySelectorAll(".yard-map-pin").length > before,
      pinsBefore,
    );
    // The opened view is saved for Back.
    await page.waitForFunction(() => location.search.startsWith("?at="));
  } finally {
    await closePage(page);
  }
}, 20_000);
