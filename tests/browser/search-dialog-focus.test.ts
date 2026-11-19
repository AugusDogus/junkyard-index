import { afterAll, beforeAll, expect, test } from "bun:test";
import { chromium, type Browser } from "playwright-core";

let browser: Browser;
let script: string;
beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/search-dialog-focus.tsx"],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const output = build.outputs[0];
  if (!build.success || !output)
    throw new Error("Could not build focus fixture");
  script = await output.text();
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

for (const width of [390, 640]) {
  test(`drawer takes and traps focus, then restores it at ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.setDefaultTimeout(3000);
    try {
      await page.route("http://focus.test/**", (route) =>
        route.fulfill({
          contentType: route.request().url().endsWith("app.js")
            ? "text/javascript"
            : "text/html",
          body: route.request().url().endsWith("app.js")
            ? script
            : '<html><body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>',
        }),
      );
      await page.goto("http://focus.test/");
      const trigger = page.getByRole("button", {
        name: "Filters",
        exact: true,
      });
      await trigger.click();
      const drawer = page.getByRole("dialog", { name: "Filters", exact: true });
      await drawer.waitFor();
      expect(
        await drawer.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        expect(
          await drawer.evaluate((el) => el.contains(document.activeElement)),
        ).toBe(true);
      }
      await page.keyboard.press("Escape");
      await drawer.waitFor({ state: "hidden" });
      await page.waitForFunction(
        () => document.activeElement?.textContent === "Filters",
      );
      expect(
        await trigger.evaluate((el) => el === document.activeElement),
      ).toBe(true);
      await trigger.click();
      await page
        .getByRole("button", { name: "Advanced search, upgrade required" })
        .click();
      const upgrade = page.getByRole("dialog", {
        name: "Upgrade to use advanced search",
      });
      await upgrade.waitFor();
      await page.waitForFunction(() =>
        document
          .querySelector('[role="dialog"]')
          ?.contains(document.activeElement),
      );
      await page.keyboard.press("Escape");
      await upgrade.waitFor({ state: "hidden" });
      await page.waitForFunction(
        () => document.activeElement?.textContent === "Filters",
        undefined,
        { timeout: 2000 },
      );
      expect(
        await trigger.evaluate((el) => el === document.activeElement),
      ).toBe(true);
    } finally {
      await page.close();
    }
  }, 15_000);
}
