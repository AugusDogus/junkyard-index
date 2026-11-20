import { afterAll, beforeAll, expect, test } from "bun:test";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";

let browser: Browser;
let script: string;
beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/search-input-history.tsx"],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "mock-search",
        setup(builder) {
          builder.onLoad({ filter: /src\/env\.js$/ }, () => ({
            contents:
              'export const env = {NEXT_PUBLIC_APP_URL:"http://history.test"};',
            loader: "js",
          }));
          builder.onResolve({ filter: /^algoliasearch\/lite$/ }, () => ({
            path: resolve("tests/browser/fixtures/shared-search-client.ts"),
          }));
        },
      },
    ],
  });
  const output = build.outputs[0];
  if (!build.success || !output)
    throw new Error(
      `Could not bundle history fixture: ${build.logs.join("\n")}`,
    );
  script = await output.text();
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser?.close();
});

async function openFixture(page: Page, search = "?q=toyota") {
  page.setDefaultTimeout(3000);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://history.test") return route.abort();
    return route.fulfill({
      contentType: url.pathname === "/app.js" ? "text/javascript" : "text/html",
      body:
        url.pathname === "/app.js"
          ? script
          : '<html><body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>',
    });
  });
  await page.goto(`http://history.test/search${search}`);
  await page.getByRole("searchbox").waitFor();
  await page.waitForTimeout(400);
}
const historyLength = (page: Page) => page.evaluate(() => history.length);
const requests = (page: Page) =>
  page.evaluate(() =>
    Number(document.documentElement.dataset.searchRequests ?? 0),
  );
async function typeAndSettle(page: Page, value: string) {
  await page.getByRole("searchbox").fill(value);
  await page.waitForFunction(
    (value) => new URL(location.href).searchParams.get("q") === value,
    value,
  );
  await page.waitForTimeout(100);
}

test("typing replaces history, submit checkpoints once, and no extra requests are sent", async () => {
  const page = await createPage(browser);
  try {
    await openFixture(page);
    const length = await historyLength(page);
    const initialRequests = await requests(page);
    for (const value of ["toyota v", "toyota ve", "toyota venza"])
      await typeAndSettle(page, value);
    expect(await historyLength(page)).toBe(length);
    expect(await requests(page)).toBe(initialRequests + 3);
    await page.getByRole("searchbox").press("Enter");
    await page.waitForTimeout(400);
    expect(await historyLength(page)).toBe(length + 1);
    expect(await requests(page)).toBe(initialRequests + 3);
    await page.goBack();
    await page.waitForFunction(
      () => document.querySelector("input")?.value === "toyota",
    );
    await page.goForward();
    await page.waitForFunction(
      () => document.querySelector("input")?.value === "toyota venza",
    );
    await page
      .getByLabel("Sort", { exact: true })
      .selectOption({ label: "Oldest First" });
    await page.waitForFunction(
      () => new URL(location.href).searchParams.get("sort") === "oldest",
    );
    expect(await historyLength(page)).toBe(length + 2);
    await page.getByRole("button", { name: "Toggle Alabama" }).click();
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.has("states[]"),
    );
    expect(await historyLength(page)).toBe(length + 3);
    await page.goBack();
    await page.waitForFunction(
      () => !new URL(location.href).searchParams.has("states[]"),
    );
    expect(new URL(page.url()).searchParams.get("sort")).toBe("oldest");
  } finally {
    await closePage(page);
  }
}, 15_000);

test("typing at a steady pace searches once, after the pause", async () => {
  const page = await createPage(browser);
  try {
    await openFixture(page);
    const initialRequests = await requests(page);
    const input = page.getByRole("searchbox");
    await input.fill("toyota");
    // Keystrokes about half a second apart, slower than the old debounce.
    for (const key of [" ", "v", "e", "n", "z", "a"]) {
      await input.press(key === " " ? "Space" : key);
      await page.waitForTimeout(450);
    }
    await page.waitForFunction(
      () => new URL(location.href).searchParams.get("q") === "toyota venza",
    );
    await page.waitForTimeout(100);
    expect(await requests(page)).toBe(initialRequests + 1);
  } finally {
    await closePage(page);
  }
}, 15_000);

test("Enter searches at once instead of waiting for the typing pause", async () => {
  const page = await createPage(browser);
  try {
    await openFixture(page);
    const initialRequests = await requests(page);
    await page.getByRole("searchbox").fill("toyota venza");
    await page.getByRole("searchbox").press("Enter");
    // Well inside the 800 ms pause the debounce would wait for.
    await page.waitForFunction(
      () => new URL(location.href).searchParams.get("q") === "toyota venza",
      undefined,
      { timeout: 400 },
    );
    // The cancelled debounce must not search again after the pause.
    await page.waitForTimeout(1000);
    expect(await requests(page)).toBe(initialRequests + 1);
  } finally {
    await closePage(page);
  }
}, 15_000);

for (const search of [
  "?q=toyota&yards[]=RTP+Pick-A-Part+-+Hebron%2C+KY&yards[]=RTP+Pick-A-Part+-+Lexington%2C+KY",
  "?q=toyota&yards=RTP+Pick-A-Part+-+Hebron%2C+KY,RTP+Pick-A-Part+-+Lexington%2C+KY",
]) {
  test(`typing retains yard URLs and self-service default: ${search}`, async () => {
    const page = await createPage(browser);
    try {
      await openFixture(page, search);
      const length = await historyLength(page);
      await typeAndSettle(page, "toyota venza");
      const params = new URL(page.url()).searchParams;
      expect(params.getAll("yards[]")).toEqual([
        "RTP Pick-A-Part - Hebron, KY",
        "RTP Pick-A-Part - Lexington, KY",
      ]);
      expect(params.getAll("yardTypes[]")).toEqual(["self_service"]);
      expect(await historyLength(page)).toBe(length);
    } finally {
      await closePage(page);
    }
  }, 10_000);
}

test("Back cancels pending typing and the next submission still works", async () => {
  const page = await createPage(browser);
  try {
    await openFixture(page);
    await page
      .getByLabel("Sort", { exact: true })
      .selectOption({ label: "Oldest First" });
    await page.waitForFunction(() =>
      new URL(location.href).searchParams.has("sort"),
    );
    await page.getByRole("searchbox").fill("stale draft");
    await page.goBack();
    await page.waitForTimeout(450);
    expect(new URL(page.url()).searchParams.get("q")).toBe("toyota");
    await page.getByRole("searchbox").fill("ford");
    await page.getByRole("searchbox").press("Enter");
    await page.waitForFunction(
      () => new URL(location.href).searchParams.get("q") === "ford",
    );
    await page.goBack();
    await page.waitForFunction(
      () => document.querySelector("input")?.value === "toyota",
    );
  } finally {
    await closePage(page);
  }
}, 10_000);

test("immediate submit after a live preview creates one final checkpoint", async () => {
  const page = await createPage(browser);
  try {
    await openFixture(page);
    const length = await historyLength(page);
    await typeAndSettle(page, "toyota v");
    await page.getByRole("searchbox").fill("ford");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForFunction(
      () => new URL(location.href).searchParams.get("q") === "ford",
    );
    await page.waitForTimeout(400);
    expect(await historyLength(page)).toBe(length + 1);
    await page.goBack();
    await page.waitForFunction(
      () => document.querySelector("input")?.value === "toyota",
    );
    await page.goForward();
    await page.waitForFunction(
      () => document.querySelector("input")?.value === "ford",
    );
    const count = await requests(page);
    await page.getByRole("searchbox").press("Enter");
    await page.waitForTimeout(400);
    expect(await historyLength(page)).toBe(length + 1);
    expect(await requests(page)).toBe(count);
    await page.getByRole("button", { name: "Clear search" }).click();
    await page.waitForFunction(
      () => !new URL(location.href).searchParams.has("q"),
    );
    expect(await historyLength(page)).toBe(length + 2);
    await page.goBack();
    await page.waitForFunction(
      () => document.querySelector("input")?.value === "ford",
    );
  } finally {
    await closePage(page);
  }
}, 12_000);

test("editing expression-owned yard types still replaces history", async () => {
  const page = await createPage(browser);
  try {
    await openFixture(page, "?q=yardType%3Afull_service&syntax=expression");
    const length = await historyLength(page);
    await typeAndSettle(page, "make:Ford");
    expect(await historyLength(page)).toBe(length);
    expect(new URL(page.url()).searchParams.get("syntax")).toBe("expression");
  } finally {
    await closePage(page);
  }
}, 10_000);
