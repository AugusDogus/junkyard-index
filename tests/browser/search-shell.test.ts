import { afterAll, beforeAll, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { chromium, type Browser } from "playwright-core";
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
      .then(
        async (source) =>
          (
            await postcss([tailwind()]).process(source, {
              from: "src/styles/globals.css",
            })
          ).css,
      ),
  ]);
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

async function open(query: string, width = 1440, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  const html = await renderSharedSearchFixture(query);
  await page.route("http://shared-search.test/**", async (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      contentType: url.pathname === "/app.js" ? "text/javascript" : "text/html",
      body:
        url.pathname === "/app.js"
          ? script
          : html.replace("</head>", `<style>${stylesheet}</style></head>`),
    });
  });
  await page.route("https://wsrv.nl/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="gray"/></svg>',
    }),
  );
  await page.goto(`http://shared-search.test/search?${query}`);
  return { page, html };
}

test("SSR includes eager visible images and the mobile cap; teasers contain no links", async () => {
  const { page, html } = await open(
    "q=pagination&fixtureGuest=1&fixtureMobile=1",
    390,
    844,
  );
  try {
    expect(html).toContain("<img");
    expect(html).toContain('fetchPriority="high"');
    expect(html).toContain("Showing 4");
    expect(html).toContain('"hitsPerPage":4');
    expect(html).toContain('"attributesToHighlight":[]');
    expect(html).not.toContain('"objectID":"pagination-91"');
    expect(await page.locator("[inert]").count()).toBe(1);
    await page.getByRole("heading", { name: "2095 Pagination Car" }).waitFor();
    expect(await page.locator("[inert] a, [inert] button").count()).toBe(0);
    expect(
      await page.locator("h3").filter({ hasText: "Pagination Car" }).count(),
    ).toBe(3);
    expect(await page.locator("img").first().getAttribute("loading")).toBe(
      "eager",
    );
    expect(
      await page.getByRole("link", { name: "View inventory" }).count(),
    ).toBe(3);
  } finally {
    await page.close();
  }
}, 30_000);

test("signed-in pagination survives sort switches and rows do not overlap after resizing", async () => {
  const { page, html } = await open("q=pagination");
  try {
    expect(html).toContain('"hitsPerPage":24');
    expect(html).not.toContain('"objectID":"pagination-71"');
    await page
      .getByText("Showing 24 of 96 vehicles", { exact: true })
      .waitFor();
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight - innerHeight),
    );
    await page
      .getByText("Showing 48 of 96 vehicles", { exact: true })
      .waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("combobox", { name: /^Sort vehicles:/ }).click();
    await page
      .getByRole("option", { name: "Oldest First", exact: true })
      .click();
    await page.getByRole("heading", { name: "2000 Pagination Car" }).waitFor();
    await page.getByRole("combobox", { name: /^Sort vehicles:/ }).click();
    await page
      .getByRole("option", { name: "Newest First", exact: true })
      .click();
    await page.getByRole("heading", { name: "2095 Pagination Car" }).waitFor();
    await page
      .getByText("Showing 48 of 96 vehicles", { exact: true })
      .waitFor();
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight - innerHeight),
    );
    await page
      .getByText("Showing 72 of 96 vehicles", { exact: true })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() =>
      window.scrollTo(0, document.body.scrollHeight - innerHeight),
    );
    await page.getByText("96 vehicles", { exact: true }).last().waitFor();
    const overlap = await page.locator("[data-index]").evaluateAll((rows) => {
      const boxes = rows
        .map((row) => row.getBoundingClientRect())
        .sort((a, b) => a.top - b.top);
      return boxes.some(
        (box, index) =>
          index > 0 && box.top < (boxes[index - 1]?.bottom ?? 0) - 1,
      );
    });
    expect(overlap).toBe(false);
  } finally {
    await page.close();
  }
}, 60_000);

test("a shared distance URL remains selected without opening a dialog", async () => {
  const { page } = await open("q=pagination&sort=distance&fixtureGuest=1");
  try {
    await page
      .getByRole("button", { name: "Distance location", exact: true })
      .waitFor();
    expect(await page.getByRole("dialog").count()).toBe(0);
    expect(new URL(page.url()).searchParams.get("sort")).toBe("distance");
    await page
      .getByRole("button", { name: "Distance location", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    await page.keyboard.press("Escape");
    expect(new URL(page.url()).searchParams.get("sort")).toBe("distance");
  } finally {
    await page.close();
  }
}, 30_000);

test("the toolbar scrolls away on short screens with filters open", async () => {
  const { page } = await open("q=pagination", 844, 390);
  try {
    await page.getByRole("button", { name: /^Filters/ }).click();
    const toolbar = page.locator("main > div.sticky");
    expect(
      await toolbar.evaluate((element) => getComputedStyle(element).position),
    ).toBe("static");
    await page.evaluate(() => window.scrollTo(0, 600));
    const box = await toolbar.boundingBox();
    expect(box?.y).toBeLessThan(0);
  } finally {
    await page.close();
  }
}, 30_000);
