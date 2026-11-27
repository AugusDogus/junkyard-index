import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";

let browser: Browser;
let script: string;

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/signed-in-redirect.tsx"],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "session",
        setup(builder) {
          // Signed in when the page URL says so.
          builder.onLoad({ filter: /src\/lib\/auth-client\.ts$/ }, () => ({
            contents:
              'export const useSession = () => new URLSearchParams(location.search).has("signed-in") ? { data: { user: { id: "fixture" } }, isPending: false } : { data: null, isPending: false };',
            loader: "js",
          }));
        },
      },
    ],
  });
  const output = build.outputs[0];
  if (!build.success || !output) throw new Error(build.logs.join("\n"));
  script = await output.text();
  browser = await launchBrowser();
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

async function navigationsFrom(query: string) {
  const page = await createPage(browser);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("http://auth.test/**", (route) =>
      new URL(route.request().url()).pathname === "/app.js"
        ? route.fulfill({ contentType: "text/javascript", body: script })
        : route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html><body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><div id="root"></div><script type="module" src="/app.js"></script></body></html>`,
          }),
    );
    await page.goto(`http://auth.test/auth/sign-in?${query}`);
    await page.getByText("Rendered").waitFor();
    // Let the effect run after the first paint.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    expect(errors).toEqual([]);
    return await page.evaluate(() => window.navigations);
  } finally {
    await closePage(page);
  }
}

for (const [returnTo, expected] of [
  ["/search?q=Saab&saveSearch=1", "/search?q=Saab&saveSearch=1"],
  ["%2Fsearch%3Fq%3DSaab%26saveSearch%3D1", "/search?q=Saab&saveSearch=1"],
  ["https://evil.example/", "/search"],
  ["//evil.example", "/search"],
  ["/auth/sign-up", "/search"],
  ["/auth/sign-in?returnTo=%2Fsearch", "/search"],
  ["/auth/unknown", "/search"],
  ["/auth/%73ign-in", "/search"],
] as const) {
  test(`a signed-in visitor leaves the auth page for ${expected} given ${returnTo}`, async () => {
    expect(
      await navigationsFrom(
        `returnTo=${encodeURIComponent(returnTo)}&signed-in=1`,
      ),
    ).toEqual([`replace ${expected}`]);
  }, 20_000);
}

test("a signed-out visitor stays on the auth page", async () => {
  expect(
    await navigationsFrom(
      `returnTo=${encodeURIComponent("/search?q=Saab&saveSearch=1")}`,
    ),
  ).toEqual([]);
}, 20_000);
