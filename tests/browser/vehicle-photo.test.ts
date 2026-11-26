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
    entrypoints: ["tests/browser/fixtures/vehicle-photo.tsx"],
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
    throw new Error("Could not bundle vehicle photo fixture.");
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

const PHOTO =
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="96"><rect width="128" height="96" fill="blue"/></svg>';

test("photos load from the proxy, fall back to the origin when it fails or stalls, then give way to the no-photo strip", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1024, height: 900 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const proxyRequests: string[] = [];
  const originRequests: string[] = [];
  try {
    // The proxy serves "ok", fails "error" and "gone" and never answers for "slow".
    await page.route("https://wsrv.nl/**", (route) => {
      const origin = new URL(route.request().url()).searchParams.get("url");
      if (origin) proxyRequests.push(origin);
      if (origin?.endsWith("/slow.jpg")) return;
      if (origin?.endsWith("/ok.jpg"))
        return route.fulfill({ contentType: "image/svg+xml", body: PHOTO });
      return route.fulfill({ status: 502, body: "Proxy failed" });
    });
    await page.route("https://photos.test/**", (route) => {
      originRequests.push(route.request().url());
      return route.request().url().endsWith("/gone.jpg")
        ? route.fulfill({ status: 404, body: "Not found" })
        : route.fulfill({ contentType: "image/svg+xml", body: PHOTO });
    });
    await page.route("http://vehicle-photo.test/**", (route) => {
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
    await page.goto("http://vehicle-photo.test/");

    const loadedOrigins = (name: string) =>
      page
        .locator(`[data-photo="${name}"] img`)
        .evaluateAll((images) =>
          images.filter(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0 &&
              image.currentSrc.startsWith("https://photos.test/"),
          ),
        );

    // The stalled proxy shows a shimmer, not an empty box.
    expect(
      await page.locator('[data-photo="slow"] [data-photo-loading]').count(),
    ).toBe(2);

    await page.waitForFunction(
      () =>
        document.querySelectorAll('[data-photo="error"] img').length === 2 &&
        [...document.querySelectorAll('[data-photo="error"] img')].every(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0 &&
            image.currentSrc.startsWith("https://photos.test/"),
        ),
      undefined,
      { timeout: 5_000 },
    );
    expect(await loadedOrigins("error")).toHaveLength(2);

    // The row's thumbnail labels itself; the card's picture box gives way
    // to the no-photo strip.
    await page
      .locator('[data-photo="gone"]')
      .getByText("No photo", { exact: true })
      .nth(1)
      .waitFor({ timeout: 5_000 });
    expect(
      await page
        .locator('[data-photo="gone"]')
        .getByText("No photo", { exact: true })
        .count(),
    ).toBe(2);
    expect(await page.locator('[data-photo="gone"] img').count()).toBe(0);

    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-photo="slow"] img')].filter(
          (image) =>
            image instanceof HTMLImageElement &&
            image.complete &&
            image.naturalWidth > 0 &&
            image.currentSrc.startsWith("https://photos.test/"),
        ).length === 2,
      undefined,
      { timeout: 8_000 },
    );
    expect(await page.locator("[data-photo-loading]").count()).toBe(0);

    // A proxy that answers keeps its photos, loaded once each, with no
    // origin request and no shimmer.
    expect(
      await page
        .locator('[data-photo="ok"] img')
        .evaluateAll((images) =>
          images.map(
            (image) =>
              image instanceof HTMLImageElement &&
              image.complete &&
              image.naturalWidth > 0 &&
              image.currentSrc.startsWith("https://wsrv.nl/"),
          ),
        ),
    ).toEqual([true, true]);
    expect(originRequests.filter((url) => url.endsWith("/ok.jpg"))).toEqual([]);
    expect(
      proxyRequests.filter((url) => url.endsWith("/ok.jpg")).length,
    ).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  } finally {
    await closePage(page);
  }
}, 20_000);
