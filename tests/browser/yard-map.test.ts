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
    await page.route(/^https?:\/\/(?!yard-map\.test)/, (route) =>
      route.abort(),
    );
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
