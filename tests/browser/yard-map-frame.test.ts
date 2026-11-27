import { afterAll, beforeAll, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Browser, Page } from "playwright-core";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { closePage, createPage, launchBrowser } from "./browser-page";
import {
  YardMapFixture,
  type YardMapFixtureProps,
} from "./fixtures/yard-map-app";

let browser: Browser;
let script: string;
let stylesheet: string;

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/yard-map-frame.tsx"],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const output = build.outputs[0];
  if (!build.success || !output)
    throw new Error("Could not bundle the yard map fixture.");
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

/** Each pin's center on screen. */
function pinCenters(page: Page) {
  return page.locator(".yard-map-pin").evaluateAll((pins) =>
    pins.map((pin) => {
      const box = pin.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }),
  );
}

/** Each static dot's center on screen, from its path's `M x y` moves. */
function dotCenters(page: Page) {
  return page.locator(".yard-map-dots").evaluate((svg) => {
    const matrix = svg instanceof SVGSVGElement ? svg.getScreenCTM() : null;
    if (!matrix) throw new Error("The static dots have no screen position.");
    // The halo paths repeat the ink paths' dots.
    return [...svg.querySelectorAll("path:not(.yard-map-dots-halo)")].flatMap(
      (path) =>
        [
          ...(path.getAttribute("d") ?? "").matchAll(/M(-?[\d.]+) (-?[\d.]+)/g),
        ].map(([, x, y]) => {
          const point = new DOMPoint(Number(x), Number(y)).matrixTransform(
            matrix,
          );
          return { x: point.x, y: point.y };
        }),
    );
  });
}

/**
 * Marker positions from the server's static dots before any script runs,
 * then the pins' once hydration measures the real size.
 */
async function framesAcrossHydration(props: YardMapFixtureProps) {
  const page = await createPage(browser, {
    viewport: { width: 1024, height: 800 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let releaseScript = () => {};
  const scriptHeld = new Promise<void>((resolve) => {
    releaseScript = resolve;
  });
  try {
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.host !== "yard-map.test")
        return route.fulfill({ status: 404, body: "" });
      if (url.pathname === "/app.js") {
        await scriptHeld;
        return route.fulfill({ contentType: "text/javascript", body: script });
      }
      if (url.pathname === "/app.css")
        return route.fulfill({ contentType: "text/css", body: stylesheet });
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root">${renderToString(createElement(YardMapFixture, props))}</div><script id="config" type="application/json">${JSON.stringify(props)}</script><script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`,
      });
    });
    await page.goto("http://yard-map.test/", { waitUntil: "commit" });
    await page.locator(".yard-map-dots").waitFor();
    await page.waitForFunction(() =>
      [...document.styleSheets].some((sheet) =>
        sheet.href?.endsWith("/app.css"),
      ),
    );
    const before = await dotCenters(page);

    releaseScript();
    await page.waitForFunction(() => document.body.dataset.hydrated === "");
    // The pins mount in batches after hydration.
    await page.waitForFunction(
      (count) => document.querySelectorAll(".yard-map-pin").length === count,
      before.length,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const after = await pinCenters(page);
    expect(errors).toEqual([]);
    return { before, after };
  } finally {
    await closePage(page);
  }
}

for (const [name, props] of [
  // The server's 900px guess for what is really a phone-width map.
  ["a narrow map guessed wide", { width: 356, height: 285 }],
  // The same guess for a wide map.
  ["a wide map", { width: 916, height: 512 }],
] as const) {
  test(`${name} keeps its framing through hydration`, async () => {
    const { before, after } = await framesAcrossHydration(props);
    expect(after).toHaveLength(before.length);
    // Every pin lands on a dot the server drew, each dot used once.
    const unmatched = [...before];
    for (const pin of after) {
      const index = unmatched.findIndex(
        (dot) => Math.abs(dot.x - pin.x) <= 2 && Math.abs(dot.y - pin.y) <= 2,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      unmatched.splice(index, 1);
    }
  }, 20_000);
}
