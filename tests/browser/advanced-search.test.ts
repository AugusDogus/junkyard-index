// Run with `bun test tests/browser` after installing Playwright Chromium.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { chromium, type Browser } from "playwright-core";
import { closePage, createPage } from "./browser-page";

let browser: Browser;
let script: string;
let stylesheet: string;

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/advanced-search.tsx"],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const output = build.outputs[0];
  if (!build.success || !output)
    throw new Error("Could not bundle the advanced search fixture.");
  script = await output.text();
  const css = await postcss([tailwind()]).process(
    await Bun.file("src/styles/globals.css").text(),
    { from: "src/styles/globals.css" },
  );
  stylesheet = css.css;
  browser = await chromium.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

describe("advanced search browser interactions", () => {
  for (const viewport of [
    { width: 1280, height: 1200 },
    { width: 390, height: 844 },
  ]) {
    test(`can choose a sort and combine inventory filters at ${viewport.width}px`, async () => {
      const page = await createPage(browser, { viewport });
      page.setDefaultTimeout(5_000);
      try {
        await page.route("http://advanced-search.test/**", (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/app.js")
            return route.fulfill({
              contentType: "text/javascript",
              body: script,
            });
          if (path === "/app.css")
            return route.fulfill({ contentType: "text/css", body: stylesheet });
          return route.fulfill({
            contentType: "text/html",
            body: `<!doctype html>
            <html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head>
            <body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`,
          });
        });
        await page.goto("http://advanced-search.test/");
        await page
          .getByRole("button", { name: "Advanced search", exact: true })
          .click();
        const dialog = page.getByRole("dialog", { name: "Advanced search" });
        await dialog.getByRole("combobox", { name: "Sort results" }).click();
        // A real pointer click catches a menu rendered behind the dialog overlay.
        await page
          .getByRole("option", { name: "Oldest First", exact: true })
          .click();
        expect(
          await page
            .getByRole("combobox", { name: "Sort results" })
            .textContent(),
        ).toBe("Oldest First");
        await page
          .getByRole("button", { name: "MakeSaab", exact: true })
          .click();
        expect(
          await page
            .getByRole("option", { name: "Saab", exact: true })
            .getAttribute("aria-selected"),
        ).toBe("true");
        for (const name of ["Ford", "Honda"]) {
          await page.getByRole("option", { name, exact: true }).click();
        }
        await page.getByRole("button", { name: "Done", exact: true }).click();
        for (const [section, name] of [
          ["Color", "Red"],
          ["State", "NE"],
          ["Salvage yard", "Omaha"],
        ]) {
          await page
            .getByRole("button", { name: "Add filter", exact: true })
            .click();
          await page
            .getByRole("menuitem", { name: section, exact: true })
            .click();
          await page.getByRole("menu").waitFor({ state: "hidden" });
          await page.getByRole("option", { name, exact: true }).click();
          await page.getByRole("button", { name: "Done", exact: true }).click();
        }
        await page
          .getByRole("button", { name: "Search inventory", exact: true })
          .click();
        const submission = await page.locator("#submission").textContent();
        expect(submission).toBe(
          JSON.stringify({
            query: "no-matching-vehicle",
            filters: {
              makes: ["Saab", "Ford", "Honda"],
              colors: ["Red"],
              states: ["NE"],
              salvageYards: ["Omaha"],
              sortBy: "oldest",
            },
          }),
        );
      } finally {
        await closePage(page);
      }
    }, 20_000);
  }
});
