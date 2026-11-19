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
    entrypoints: ["tests/browser/fixtures/vehicle-cards.tsx"],
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
    throw new Error("Could not bundle search card fixture.");
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

for (const width of [390, 1440]) {
  for (const dark of [false, true]) {
    test(`provider cards wrap details without clipping at ${width}px, dark=${dark}`, async () => {
      const page = await createPage(browser, {
        viewport: { width, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.route("**/*", (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/app.js")
            return route.fulfill({
              contentType: "text/javascript",
              body: script,
            });
          if (path === "/app.css")
            return route.fulfill({ contentType: "text/css", body: stylesheet });
          if (route.request().resourceType() === "image")
            return route.fulfill({
              contentType: "image/svg+xml",
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#778899"/></svg>',
            });
          return route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html class="${dark ? "dark" : ""}"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`,
          });
        });
        await page.goto("https://cards.test/");
        await page
          .getByText("Section Cars · Row 13 · Space 6", { exact: true })
          .waitFor({ timeout: 5000 });
        expect(errors).toEqual([]);
        expect(await page.getByRole("article").count()).toBe(5);
        for (const text of [
          "Row 215",
          "Row 52",
          "Row 7",
          "2.4L I4",
          "Automatic",
          "Seen Nov 18, 2026",
          "Date unknown",
          "Yard type: Full-service",
          "Parts may already be pulled. Call the yard.",
        ]) {
          expect(await page.getByText(text, { exact: true }).count()).toBe(1);
        }
        expect(await page.getByLabel("69 mi from your location").count()).toBe(
          4,
        );
        expect(await page.getByLabel("10 mi from your location").count()).toBe(
          1,
        );
        expect(
          await page.locator("article").evaluateAll((cards) =>
            cards.every((card) => {
              const bounds = card.getBoundingClientRect();
              return (
                bounds.height < 650 &&
                card.scrollWidth <= card.clientWidth &&
                [...card.querySelectorAll("h3, dd, p, a")].every((element) => {
                  const child = element.getBoundingClientRect();
                  return (
                    child.left >= bounds.left &&
                    child.right <= bounds.right &&
                    element.scrollWidth <= element.clientWidth + 1
                  );
                })
              );
            }),
          ),
        ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        if (width === 1440) {
          const tops = await page
            .locator("article")
            .evaluateAll((cards) =>
              cards.slice(0, 3).map((card) => card.getBoundingClientRect().top),
            );
          expect(new Set(tops).size).toBe(1);
        }
      } finally {
        await closePage(page);
      }
    }, 20_000);
  }
}
