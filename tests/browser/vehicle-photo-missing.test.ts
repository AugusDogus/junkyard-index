import { afterAll, beforeAll, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Browser } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";

let browser: Browser;
let script: string;
let stylesheet: string;

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/vehicle-photo-missing.tsx"],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "next-image-interop",
        setup(builder) {
          // Use the real image component without Bun's CJS default-export wrapper.
          builder.onLoad({ filter: /next\/image\.js$/ }, () => ({
            contents:
              'export { Image as default } from "next/dist/client/image-component";',
            loader: "js",
          }));
        },
      },
    ],
  });
  const output = build.outputs[0];
  if (!build.success || !output)
    throw new Error("Could not bundle missing photo fixture.");
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

test("a photo that fails to load leaves the compact no-photo strip, not an empty picture box", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1024, height: 900 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("https://wsrv.nl/**", (route) =>
      route.fulfill({ status: 404, body: "Not found" }),
    );
    await page.route("https://photos.test/**", (route) =>
      route.fulfill({ status: 404, body: "Not found" }),
    );
    await page.route("http://vehicle-photo-missing.test/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/app.js")
        return route.fulfill({ contentType: "text/javascript", body: script });
      if (path === "/app.css")
        return route.fulfill({ contentType: "text/css", body: stylesheet });
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`,
      });
    });
    await page.goto("http://vehicle-photo-missing.test/");

    // The proxy fails, the origin fails, then each surface gives up the
    // photo. Off-screen arrivals are lazy and wait until they scroll in.
    const searchCard = '[data-surface="search-card"]';
    const firstArrival = '[data-surface="arrivals"] a:first-of-type';
    const inventoryRow = '[data-surface="inventory-row"]';
    await page.waitForFunction(
      (selectors) =>
        selectors.every((selector) => {
          const surface = document.querySelector(selector);
          return surface !== null && surface.querySelector("img") === null;
        }),
      [searchCard, firstArrival, inventoryRow],
      { timeout: 8_000 },
    );

    // Picture boxes still on the page, by their aspect ratio.
    const pictureBoxes = (selector: string) =>
      page.locator(`${selector} *`).evaluateAll(
        (elements) =>
          elements.filter((element) => {
            const ratio = getComputedStyle(element).aspectRatio;
            return ratio === "2 / 1" || ratio === "4 / 3";
          }).length,
      );

    const card = page.locator(searchCard);
    await card.getByText("No photo", { exact: true }).waitFor();
    expect(await card.getByText("Stock #12345").count()).toBe(1);
    expect(await card.getByText("No Image Available").count()).toBe(0);
    expect(await pictureBoxes(searchCard)).toBe(0);

    const arrival = page.locator(firstArrival);
    expect(await arrival.getByText("No photo", { exact: true }).count()).toBe(
      1,
    );
    expect(await arrival.getByText("No Image Available").count()).toBe(0);
    expect(await pictureBoxes(firstArrival)).toBe(0);

    // An inventory row's thumbnail is already small; it keeps its label.
    expect(
      await page
        .locator(inventoryRow)
        .getByText("No photo", { exact: true })
        .count(),
    ).toBe(1);

    expect(errors).toEqual([]);
  } finally {
    await closePage(page);
  }
}, 20_000);
