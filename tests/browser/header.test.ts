import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Browser } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";

let browser: Browser;
let directory: string;
let server: string;
let script: string;
let stylesheet: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "header-browser-"));
  for (const target of ["bun", "browser"] as const) {
    const build = await Bun.build({
      entrypoints: ["tests/browser/fixtures/header.tsx"],
      target,
      define: { "process.env.NODE_ENV": '"production"' },
      plugins: [
        {
          name: "header-services",
          setup(builder) {
            builder.onLoad({ filter: /src\/env\.js$/ }, () => ({
              contents: "export const env = {};",
              loader: "js",
            }));
            builder.onLoad({ filter: /src\/lib\/auth-client\.ts$/ }, () => ({
              contents:
                'export const useSession = () => ({ data: { user: { name: "Header Test", email: "header@example.com" } }, isPending: false }); export const signOut = async () => {}; export const authClient = {};',
              loader: "js",
            }));
            builder.onLoad(
              { filter: /src\/hooks\/use-billing-account\.ts$/ },
              () => ({
                contents:
                  'export const useBillingAccount = () => ({ state: { kind: "none" }, retry() {} });',
                loader: "js",
              }),
            );
          },
        },
      ],
    });
    const output = build.outputs[0];
    if (!build.success || !output) throw new Error(build.logs.join("\n"));
    if (target === "browser") script = await output.text();
    else {
      server = join(directory, "server.mjs");
      await Bun.write(server, await output.text());
    }
  }
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
  await rm(directory, { recursive: true, force: true });
});

for (const width of [390, 640, 1440]) {
  for (const signedIn of [false, true]) {
    test(`header hydrates and supports keyboard navigation at ${width}px, signed in: ${signedIn}`, async () => {
      const path = `/junkyards/texas?q=Saab&saveSearch=1${signedIn ? "&signed-in=1" : ""}`;
      const result = Bun.spawn(["bun", server, path], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [html, errors, status] = await Promise.all([
        new Response(result.stdout).text(),
        new Response(result.stderr).text(),
        result.exited,
      ]);
      if (status !== 0) throw new Error(errors);
      const page = await createPage(browser, {
        viewport: { width, height: 900 },
      });
      const hydrationErrors: string[] = [];
      page.on("pageerror", (error) => hydrationErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") hydrationErrors.push(message.text());
      });
      try {
        await page.route("http://header.test/**", (route) => {
          const pathname = new URL(route.request().url()).pathname;
          return route.fulfill({
            contentType:
              pathname === "/app.js"
                ? "text/javascript"
                : pathname === "/app.css"
                  ? "text/css"
                  : "text/html",
            body:
              pathname === "/app.js"
                ? script
                : pathname === "/app.css"
                  ? stylesheet
                  : `<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><div id="root">${html}</div><script type="module" src="/app.js"></script></body></html>`,
          });
        });
        await page.goto(`http://header.test${path}`);
        if (signedIn) {
          await page.getByRole("button", { name: "HT", exact: true }).click();
          await page
            .getByRole("menuitem", { name: "Settings", exact: true })
            .waitFor();
          await page.keyboard.press("Escape");
          await page.getByRole("menu").waitFor({ state: "hidden" });
        } else {
          const signIn = page.getByRole("link", {
            name: "Sign in",
            exact: true,
          });
          expect(await signIn.isVisible()).toBe(true);
          expect(await signIn.getAttribute("href")).toBe(
            `/auth/sign-in?returnTo=${encodeURIComponent(path)}`,
          );
        }
        for (const label of ["Junkyards", "Cars", "Pricing", "Search"]) {
          expect(
            await page
              .getByRole("link", { name: label, exact: true })
              .filter({ visible: true })
              .count(),
          ).toBe(1);
        }
        await page.getByRole("link", { name: "Skip to content" }).focus();
        await page.keyboard.press("Enter");
        expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
          "MAIN",
        );
        await page.keyboard.press("Tab");
        expect(
          await page.evaluate(() => document.activeElement?.textContent),
        ).toBe("First content link");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(hydrationErrors).toEqual([]);
      } finally {
        await closePage(page);
      }
    }, 20_000);
  }
}
