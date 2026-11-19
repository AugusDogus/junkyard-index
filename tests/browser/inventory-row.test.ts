import { afterAll, beforeAll, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { chromium, type Browser, type Page } from "playwright-core";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { VehicleRowPhoto } from "~/components/inventory/VehicleRowPhoto";
import { closePage, createPage } from "./browser-page";

let browser: Browser;
let script: string;
let stylesheet: string;

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/inventory-row.tsx"],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const output = build.outputs[0];
  if (!build.success || !output)
    throw new Error("Could not bundle inventory row fixture.");
  script = await output.text();
  stylesheet = (
    await postcss([tailwind()]).process(
      await Bun.file("src/styles/globals.css").text(),
      { from: "src/styles/globals.css" },
    )
  ).css;
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

async function openFixture(page: Page, hydrate = false) {
  page.setDefaultTimeout(5_000);
  await page.route("https://da8h1v3w8q6n5.cloudfront.net/**", (route) =>
    route.request().url().endsWith("broken.jpg")
      ? route.fulfill({ status: 404, body: "Photo unavailable" })
      : route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><rect width="128" height="96" fill="blue"/></svg>',
        }),
  );
  await page.route("http://inventory-row.test/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/app.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (path === "/app.css")
      return route.fulfill({ contentType: "text/css", body: stylesheet });
    const markup = hydrate
      ? renderToString(
          createElement(VehicleRowPhoto, {
            src: "https://da8h1v3w8q6n5.cloudfront.net/kk25/broken.jpg",
          }),
        )
      : "";
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body>${markup}<script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`,
    });
  });
  await page.goto(`http://inventory-row.test/${hydrate ? "?hydrate" : ""}`);
}

test("photos that fail before hydration also show the placeholder", async () => {
  const page = await createPage(browser);
  try {
    await openFixture(page, true);
    await page.waitForFunction(() => {
      const img = document.querySelector("img");
      return img?.complete && img.naturalWidth === 0;
    });
    await page.evaluate(() => window.dispatchEvent(new Event("hydrate-photo")));
    await page.getByText("No photo", { exact: true }).waitFor();
    expect(await page.locator("img").count()).toBe(0);
  } finally {
    await closePage(page);
  }
}, 20_000);

test("failed photos show the placeholder and a changed source can load", async () => {
  const page = await createPage(browser, {
    viewport: { width: 390, height: 844 },
  });
  try {
    await openFixture(page);
    await page.getByText("No photo", { exact: true }).nth(1).waitFor();
    expect(await page.locator("img").count()).toBe(0);
    await page.getByRole("button", { name: "Change photo" }).click();
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll("img")];
      return (
        images.length === 2 &&
        images.every((img) => img.complete && img.naturalWidth > 0)
      );
    });
    expect(await page.getByText("No photo", { exact: true }).count()).toBe(0);
  } finally {
    await closePage(page);
  }
});

for (const width of [320, 390, 1440]) {
  test(`long VINs and arrival dates stay inside inventory rows at ${width}px`, async () => {
    const page = await createPage(browser, {
      viewport: { width, height: 900 },
    });
    try {
      await openFixture(page);
      await page
        .getByRole("heading", { name: "2004 Honda Civic" })
        .first()
        .waitFor();
      const measurements = await page
        .locator("main > ul > li")
        .evaluateAll((rows) =>
          rows.map((row) => {
            row.scrollIntoView();
            const bounds = row.getBoundingClientRect();
            return {
              overflows: row.scrollWidth > row.clientWidth,
              outside: [...row.querySelectorAll("span, li")]
                .filter((element) => {
                  const rect = element.getBoundingClientRect();
                  return (
                    rect.left < bounds.left - 1 || rect.right > bounds.right + 1
                  );
                })
                .map((element) => element.textContent),
            };
          }),
        );
      expect(measurements).toHaveLength(3);
      for (const row of measurements) {
        expect(row.overflows).toBe(false);
        expect(row.outside).toEqual([]);
      }
      expect(await page.getByText("Row not listed by the yard").count()).toBe(
        0,
      );
    } finally {
      await closePage(page);
    }
  });
}
