import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";

let browser: Browser;
let script: string;

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/request-yard.tsx"],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "request-yard-services",
        setup(builder) {
          // Signed in when the page URL says so.
          builder.onLoad({ filter: /src\/lib\/auth-client\.ts$/ }, () => ({
            contents:
              'export const useSession = () => new URLSearchParams(location.search).has("signed-in") ? { data: { user: { email: "yard@example.com" } }, isPending: false } : { data: null, isPending: false };',
            loader: "js",
          }));
          builder.onLoad({ filter: /src\/trpc\/react\.tsx$/ }, () => ({
            contents:
              "export const api = { yardRequests: { create: { useMutation: () => ({ mutate() {}, isPending: false }) } } };",
            loader: "js",
          }));
          builder.onLoad({ filter: /src\/lib\/analytics\.ts$/ }, () => ({
            contents:
              "export const Analytics = { capture() {}, distinctId: async () => undefined };",
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

async function emailField(query: string) {
  const page = await createPage(browser);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.route("http://request-yard.test/**", (route) =>
      new URL(route.request().url()).pathname === "/app.js"
        ? route.fulfill({ contentType: "text/javascript", body: script })
        : route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html><body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><div id="root"></div><script type="module" src="/app.js"></script></body></html>`,
          }),
    );
    await page.goto(`http://request-yard.test/request-yard${query}`);
    const field = page.getByLabel("Your email");
    await field.waitFor();
    await page.waitForFunction(
      (expected) =>
        (document.querySelector<HTMLInputElement>("#email")?.value ?? "") ===
        expected,
      query ? "yard@example.com" : "",
      { timeout: 5_000 },
    );
    expect(errors).toEqual([]);
    return await field.inputValue();
  } finally {
    await closePage(page);
  }
}

test("a signed-in visitor's email fills in once the session loads", async () => {
  expect(await emailField("?signed-in=1")).toBe("yard@example.com");
}, 20_000);

test("a signed-out visitor starts with an empty email", async () => {
  expect(await emailField("")).toBe("");
}, 20_000);
