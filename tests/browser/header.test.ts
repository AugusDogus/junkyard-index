import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Browser } from "playwright-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FooterLinks } from "~/components/FooterLinks";
import { closePage, createPage, launchBrowser } from "./browser-page";

let browser: Browser;
let directory: string;
let server: string;
let script: string;
let stylesheet: string;
const statusPageUrl = "https://status.example.test";

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
              contents: `export const env = { NEXT_PUBLIC_STATUS_PAGE_URL: "${statusPageUrl}" };`,
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
        for (const label of ["Junkyards", "Map", "Cars", "Pricing", "Search"]) {
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

/**
 * next/font defines --font-brand in the app. Without it the font stack
 * is invalid and text falls back to a proportional face, narrower than the
 * monospace the site sets every glyph in, so widths would read too small.
 */
const monospaceBody = `<style>:root{--font-brand:ui-monospace}</style>`;

async function openHeader(path: string, width: number) {
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
            : `<!doctype html><html><head><link rel="stylesheet" href="/app.css">${monospaceBody}</head><body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><div id="root">${html}</div><script type="module" src="/app.js"></script></body></html>`,
    });
  });
  await page.goto(`http://header.test${path}`);
  return page;
}

for (const width of [390, 1440]) {
  test(`the yard map link marks the current page at ${width}px`, async () => {
    const page = await openHeader("/map?signed-in=1", width);
    try {
      const map = page
        .getByRole("link", { name: "Map", exact: true })
        .filter({ visible: true });
      expect(await map.count()).toBe(1);
      expect(await map.getAttribute("href")).toBe("/map");
      expect(await map.getAttribute("aria-current")).toBe("page");
    } finally {
      await closePage(page);
    }
  }, 20_000);
}

for (const width of [320, 360, 375]) {
  test(`the phone nav row fits a ${width}px screen without scrolling`, async () => {
    const page = await openHeader("/junkyards?signed-in=1", width);
    try {
      for (const label of ["Junkyards", "Map", "Cars", "Pricing", "Search"]) {
        expect(
          await page
            .getByRole("link", { name: label, exact: true })
            .filter({ visible: true })
            .count(),
        ).toBe(1);
      }
      // The row clips its overflow, so the page never scrolls sideways; a
      // link past its edge would be hidden with no cue that the row scrolls.
      const nav = page
        .getByRole("navigation", { name: "Main", exact: true })
        .filter({ visible: true });
      expect(
        await nav.evaluate((row) => row.scrollWidth <= row.clientWidth),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await closePage(page);
    }
  }, 20_000);
}

test("the account menu ends with Sign out and carries every footer link the header lacks under More, by keyboard", async () => {
  const footerLinks = [
    ...renderToStaticMarkup(createElement(FooterLinks)).matchAll(
      /<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g,
    ),
  ].flatMap(([, href, name]) =>
    href && name ? [{ href, name: name.trim() }] : [],
  );
  expect(footerLinks.length).toBeGreaterThan(0);
  const page = await openHeader("/junkyards/texas?signed-in=1", 1440);
  try {
    const headerHrefs = await page
      .locator("header a[href]")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    const footerOnly = footerLinks.filter(
      (link) => !headerHrefs.includes(link.href),
    );
    expect(footerOnly.map((link) => link.name)).toEqual(
      expect.arrayContaining([
        "Request a Yard",
        "Contact",
        "GitHub",
        "Privacy Policy",
        "Terms of Service",
      ]),
    );

    const trigger = page.getByRole("button", { name: "HT", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu").first();
    await menu.waitFor();
    // The top level holds the account actions only, with Sign out last.
    const topLevel = await menu
      .getByRole("menuitem")
      .evaluateAll((elements) =>
        elements.map((element) => (element.textContent ?? "").trim()),
      );
    expect(topLevel.at(-1)).toBe("Sign out");
    expect(topLevel).toContain("More");
    for (const link of footerOnly) expect(topLevel).not.toContain(link.name);

    // Radix moves focus into the menu after it opens; End needs it there.
    await page.waitForFunction(() =>
      document.activeElement?.closest('[role="menu"]'),
    );
    await page.keyboard.press("End");
    await page.waitForFunction(
      () => document.activeElement?.textContent?.trim() === "Sign out",
    );
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(
      () => document.activeElement?.textContent?.trim() === "More",
    );
    await page.keyboard.press("ArrowRight");
    const siteLinks = page.getByRole("group", {
      name: "Site links",
      exact: true,
    });
    await siteLinks.waitFor();
    expect(await siteLinks.count()).toBe(1);
    const items = await siteLinks
      .getByRole("menuitem")
      .evaluateAll((elements) =>
        elements.map((element) => ({
          href: element.getAttribute("href"),
          name: (element.textContent ?? "").trim(),
        })),
      );
    for (const link of footerOnly) expect(items).toContainEqual(link);
    expect(items).toContainEqual({
      href: statusPageUrl,
      name: "System status",
    });

    await page.waitForFunction(() =>
      document.activeElement?.closest('[aria-label="Site links"]'),
    );
    await page.keyboard.press("End");
    await page.waitForFunction(
      () => document.activeElement?.textContent?.trim() === "System status",
    );
    expect(
      await siteLinks
        .getByRole("menuitem", { name: "System status", exact: true })
        .getAttribute("target"),
    ).toBe("_blank");
  } finally {
    await closePage(page);
  }
}, 20_000);

for (const width of [390, 1440]) {
  test(`the account menu's site links are touch-sized on phones only: ${width}px`, async () => {
    const page = await openHeader("/junkyards/texas?signed-in=1", width);
    try {
      await page.getByRole("button", { name: "HT", exact: true }).click();
      await page.getByRole("menuitem", { name: "More", exact: true }).click();
      const links = page
        .getByRole("group", { name: "Site links", exact: true })
        .getByRole("menuitem");
      await links.first().waitFor();
      // Layout heights: the menu's open animation scales its boxes.
      const heights = await links.evaluateAll((items) =>
        items.map((item) =>
          item instanceof HTMLElement ? item.offsetHeight : 0,
        ),
      );
      expect(heights.length).toBeGreaterThan(0);
      for (const height of heights) {
        // The footer's own links are 44px on phones, 36px from sm up.
        if (width < 640) expect(height).toBeGreaterThanOrEqual(44);
        else expect(height).toBeLessThanOrEqual(32);
      }
    } finally {
      await closePage(page);
    }
  }, 20_000);
}

test("closing the account menu returns focus to its trigger after keyboard use only", async () => {
  const page = await openHeader("/junkyards/texas?signed-in=1", 1440);
  try {
    const trigger = page.getByRole("button", { name: "HT", exact: true });
    const menu = page.getByRole("menu").first();
    const triggerFocusVisible = () =>
      trigger.evaluate((element) => element.matches(":focus-visible"));

    // A click outside leaves no focus ring on the avatar.
    await trigger.click();
    await menu.waitFor();
    await page.mouse.click(5, 600);
    await menu.waitFor({ state: "hidden" });
    expect(await triggerFocusVisible()).toBe(false);

    // Keyboard users get focus, and its ring, back on the trigger.
    await trigger.focus();
    await page.keyboard.press("Enter");
    await menu.waitFor();
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    expect(await triggerFocusVisible()).toBe(true);
  } finally {
    await closePage(page);
  }
}, 20_000);

for (const width of [390, 1440]) {
  test(`an open account menu keeps the sticky header in view after scrolling: ${width}px`, async () => {
    const page = await openHeader("/junkyards/texas?signed-in=1", width);
    try {
      // A long page, scrolled, as on /search before opening a menu.
      await page.evaluate(() => {
        // The header's parent, so its sticky range covers the whole page.
        // React never rewrites the root's own style.
        const root = document.getElementById("root");
        if (root) root.style.minHeight = "5000px";
        window.scrollTo(0, 600);
      });
      expect(await page.evaluate(() => window.scrollY)).toBe(600);
      // Open by keyboard: a pointer click would first scroll the trigger into view.
      await page
        .getByRole("button", { name: "HT", exact: true })
        .evaluate((trigger) =>
          (trigger as HTMLElement).focus({ preventScroll: true }),
        );
      await page.keyboard.press("Enter");
      await page.getByRole("menu").first().waitFor();
      expect(
        await page.evaluate(() => "scrollLocked" in document.body.dataset),
      ).toBe(true);
      // Scroll locking must not turn body into the header's scroll container.
      const header = await page.evaluate(() => {
        const box = document.querySelector("header")?.getBoundingClientRect();
        return { top: box?.top, scrollY: window.scrollY };
      });
      expect(header).toEqual({ top: 0, scrollY: 600 });
    } finally {
      await closePage(page);
    }
  }, 20_000);
}
