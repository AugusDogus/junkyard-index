import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { chromium, type Browser, type Page } from "playwright-core";

let browser: Browser;
let script: string;
let stylesheet: string;

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/saved-search.tsx"],
    target: "browser",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.SKIP_ENV_VALIDATION": '"1"',
      "process.env.NEXT_PUBLIC_ALGOLIA_APP_ID": '"test"',
      "process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY": '"test"',
    },
  });
  const output = build.outputs[0];
  if (!build.success || !output)
    throw new Error(
      `Could not bundle saved-search fixture: ${build.logs.join("\n")}`,
    );
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

async function openFixture(page: Page, parameters = "") {
  await page.route(/algolia/, (route) => route.abort());
  await page.route("http://saved-search.test/**", (route) => {
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
  await page.goto(`http://saved-search.test/${parameters}`);
}

describe("saved search browser flow", () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    test(`edits Boolean criteria and future-inventory values at ${viewport.width}px`, async () => {
      const page = await browser.newPage({ viewport });
      try {
        await openFixture(page);
        await page
          .getByRole("button", { name: "Edit saved search Future donor" })
          .click();
        await page.evaluate(() =>
          Promise.all(
            document.getAnimations().map((animation) => animation.finished),
          ),
        );
        expect(
          await page
            .getByRole("dialog")
            .locator("form")
            .evaluate((form) => form.scrollHeight <= form.clientHeight + 1),
        ).toBe(true);
        expect(
          await page
            .getByLabel("All of these words", { exact: true })
            .inputValue(),
        ).toBe("wagon");
        expect(
          await page
            .getByLabel("This exact phrase", { exact: true })
            .inputValue(),
        ).toBe("roof rack");
        expect(
          await page
            .getByLabel("Any of these words", { exact: true })
            .inputValue(),
        ).toBe("Volvo, Saab");
        expect(
          await page
            .getByLabel("None of these words", { exact: true })
            .inputValue(),
        ).toBe("diesel");
        await page
          .getByLabel("Search name", { exact: true })
          .fill("Future wagon");
        await page
          .getByLabel("None of these words", { exact: true })
          .fill("diesel, damaged");
        await page
          .getByRole("button", { name: "Make 1 selected", exact: true })
          .click();
        await page
          .getByRole("checkbox", { name: "Saab", exact: true })
          .uncheck();
        expect(
          await page
            .getByRole("checkbox", { name: "Saab", exact: true })
            .count(),
        ).toBe(1);
        await page
          .getByRole("textbox", { name: "Search makes", exact: true })
          .fill("  Qvale  ");
        await page
          .getByRole("textbox", { name: "Search makes", exact: true })
          .press("Enter");
        expect(await page.getByRole("dialog").count()).toBe(1);
        expect(
          await page
            .getByRole("checkbox", { name: "Qvale", exact: true })
            .isChecked(),
        ).toBe(true);
        await page.getByRole("combobox", { name: "Order results by" }).click();
        await page
          .getByRole("option", { name: "Oldest First", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Save changes", exact: true })
          .click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        const submission = await page.locator("#submission").textContent();
        expect(submission).toContain(
          JSON.stringify('wagon "roof rack" (Volvo OR Saab) !diesel !damaged'),
        );
        expect(submission).toContain('"makes":["Qvale"]');
        expect(submission).toContain('"sortBy":"oldest"');
        expect(submission).not.toContain("emailAlertsEnabled");
      } finally {
        await page.close();
      }
    }, 20_000);

    test(`saves a filter-only search and preserves edits after a failed save at ${viewport.width}px`, async () => {
      const page = await browser.newPage({ viewport });
      try {
        await openFixture(page, "?fail=1");
        await page
          .getByRole("button", { name: "Save Search", exact: true })
          .click();
        await page
          .getByLabel("Name", { exact: true })
          .fill("Waiting for a Saab");
        await page
          .getByRole("button", { name: "Edit criteria", exact: true })
          .click();
        await page.getByRole("button", { name: "Color", exact: true }).click();
        await page
          .getByRole("textbox", { name: "Search colors", exact: true })
          .fill("Purple");
        await page
          .getByRole("button", { name: "Add “Purple”", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Save search", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "The save failed" })
          .waitFor();
        expect(
          await page.getByLabel("Name", { exact: true }).inputValue(),
        ).toBe("Waiting for a Saab");
        expect(
          await page
            .getByRole("checkbox", { name: "Purple", exact: true })
            .isChecked(),
        ).toBe(true);
        await page
          .getByRole("button", { name: "Save search", exact: true })
          .click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        expect(await page.locator("#submission").textContent()).toContain(
          '"query":""',
        );
        expect(await page.locator("#submission").textContent()).toContain(
          '"colors":["Purple"]',
        );
      } finally {
        await page.close();
      }
    }, 20_000);
  }

  for (const settings of [false, true]) {
    for (const width of [390, 1440]) {
      test(`edits alerts with criteria and discards cancelled changes in ${settings ? "Settings" : "search"} at ${width}px`, async () => {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
        });
        try {
          await openFixture(
            page,
            `?discord=1&multiple=1${settings ? "&settings=1" : "&scene=1"}`,
          );
          const first = page.getByRole("article", {
            name: "Future donor",
            exact: true,
          });
          const second = page.getByRole("article", {
            name: "Tacoma donor with a particularly long saved search name",
            exact: true,
          });
          await first.waitFor();
          expect(
            await first.getByText("Alerts: Email", { exact: true }).count(),
          ).toBe(1);
          expect(
            await second.getByText("Alerts: Discord", { exact: true }).count(),
          ).toBe(1);
          expect(await page.getByRole("switch").count()).toBe(0);
          expect(
            await page
              .getByRole("button", { name: /Delete saved search/ })
              .count(),
          ).toBe(0);
          await first
            .getByRole("button", { name: "Edit saved search Future donor" })
            .click();
          await page.getByRole("tab", { name: "Alerts", exact: true }).click();
          const email = page.getByRole("switch", {
            name: "Email alerts for Future donor",
          });
          const discord = page.getByRole("switch", {
            name: "Discord alerts for Future donor",
          });
          expect(await email.isChecked()).toBe(true);
          expect(await discord.isChecked()).toBe(false);
          await email.click();
          await discord.click();
          expect(await page.locator("#submission").textContent()).toBe("null");
          await page
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
          expect(
            await first.getByText("Alerts: Email", { exact: true }).count(),
          ).toBe(1);
          await first
            .getByRole("button", { name: "Edit saved search Future donor" })
            .click();
          await page
            .getByLabel("Search name", { exact: true })
            .fill("Updated donor");
          await page.getByRole("tab", { name: "Alerts", exact: true }).click();
          expect(await email.isChecked()).toBe(true);
          await email.click();
          await discord.click();
          await page
            .getByRole("button", { name: "Save changes", exact: true })
            .click();
          await page.getByRole("dialog").waitFor({ state: "hidden" });
          const updated = page.getByRole("article", {
            name: "Updated donor",
            exact: true,
          });
          await updated.getByText("Alerts: Discord", { exact: true }).waitFor();
          expect(
            await second.getByText("Alerts: Discord", { exact: true }).count(),
          ).toBe(1);
          expect(await page.locator("#submission").textContent()).toContain(
            '"path":"savedSearches.update"',
          );
          expect(await page.locator("#submission").textContent()).toContain(
            '"emailAlertsEnabled":false,"discordAlertsEnabled":true',
          );
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
          ).toBe(true);
        } finally {
          await page.close();
        }
      }, 20_000);
    }

    test(`confirms deletion within the editor in ${settings ? "Settings" : "search"}`, async () => {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
      });
      try {
        await openFixture(
          page,
          `?multiple=1${settings ? "&settings=1" : "&scene=1"}`,
        );
        await page
          .getByRole("button", { name: "Edit saved search Future donor" })
          .click();
        const deleteButton = page.getByRole("button", {
          name: "Delete saved search Future donor",
        });
        await deleteButton.click();
        const confirmation = page.getByRole("alertdialog");
        const cancel = confirmation.getByRole("button", {
          name: "Cancel",
          exact: true,
        });
        expect(
          await cancel.evaluate(
            (element) => document.activeElement === element,
          ),
        ).toBe(true);
        await cancel.click();
        await confirmation.waitFor({ state: "hidden" });
        await page.waitForFunction(
          () =>
            document.activeElement?.getAttribute("aria-label") ===
            "Delete saved search Future donor",
        );
        await deleteButton.click();
        await confirmation
          .getByRole("button", { name: "Delete search", exact: true })
          .click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        await page
          .getByRole("article", { name: "Future donor", exact: true })
          .waitFor({ state: "hidden" });
        expect(await page.getByRole("article").count()).toBe(1);
        expect(await page.locator("#submission").textContent()).toBe(
          JSON.stringify({
            path: "savedSearches.delete",
            input: { id: "saved-volvo" },
          }),
        );
      } finally {
        await page.close();
      }
    }, 20_000);
  }

  test("preserves both drafts through notification setup and a failed combined save", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    try {
      await openFixture(page, "?discord=1&fail=1");
      const open = page.getByRole("link", {
        name: "Open saved search Future donor",
      });
      const bounds = await open.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(44);
      await page
        .getByRole("button", { name: "Edit saved search Future donor" })
        .click();
      await page
        .getByLabel("Search name", { exact: true })
        .fill("My new donor");
      await page.getByRole("tab", { name: "Alerts", exact: true }).click();
      await page
        .getByRole("switch", { name: "Discord alerts for Future donor" })
        .click();
      const popupPromise = page.waitForEvent("popup");
      await page
        .getByRole("link", { name: "Notification setup (opens a new tab)" })
        .click();
      const popup = await popupPromise;
      await popup.close();
      expect(await page.getByRole("dialog").count()).toBe(1);
      expect(
        await page
          .getByRole("switch", { name: "Discord alerts for Future donor" })
          .isChecked(),
      ).toBe(true);
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "The save failed" })
        .waitFor();
      await page
        .getByRole("tab", { name: "Search criteria", exact: true })
        .click();
      expect(
        await page.getByLabel("Search name", { exact: true }).inputValue(),
      ).toBe("My new donor");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page
        .getByRole("article", { name: "My new donor", exact: true })
        .getByText("Alerts: Email + Discord", { exact: true })
        .waitFor();
    } finally {
      await page.close();
    }
  }, 20_000);

  test("keeps a failed deletion open with recovery and preserves the search", async () => {
    const page = await browser.newPage();
    try {
      await openFixture(page, "?fail=1");
      await page
        .getByRole("button", { name: "Edit saved search Future donor" })
        .click();
      await page
        .getByRole("button", { name: "Delete saved search Future donor" })
        .click();
      const confirmation = page.getByRole("alertdialog");
      await confirmation
        .getByRole("button", { name: "Delete search", exact: true })
        .click();
      await confirmation.getByRole("alert").waitFor();
      expect(
        await page
          .getByRole("article", {
            name: "Future donor",
            exact: true,
            includeHidden: true,
          })
          .count(),
      ).toBe(1);
      await confirmation
        .getByRole("button", { name: "Delete search", exact: true })
        .click();
      await confirmation.waitFor({ state: "hidden" });
      await page.getByText("No saved searches yet", { exact: true }).waitFor();
    } finally {
      await page.close();
    }
  }, 20_000);

  test("preserves complex syntax, validates errors, and discards cancelled changes", async () => {
    const page = await browser.newPage();
    try {
      const query = '(Ford OR Ram) (diesel OR gasoline) "crew cab"';
      await openFixture(
        page,
        `?query=${encodeURIComponent(query)}&no-suggestions=1`,
      );
      await page
        .getByRole("button", { name: "Edit saved search Future donor" })
        .click();
      expect(
        await page.getByLabel("Search query", { exact: true }).inputValue(),
      ).toBe(query);
      await page.getByLabel("Search query", { exact: true }).fill("Ford OR");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "both sides of OR" })
        .waitFor();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("button", { name: "Edit saved search Future donor" })
        .click();
      expect(
        await page.getByLabel("Search query", { exact: true }).inputValue(),
      ).toBe(query);
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      expect(await page.locator("#submission").textContent()).toContain(
        JSON.stringify(query),
      );
    } finally {
      await page.close();
    }
  });

  test("keeps mode drafts and rejects an incomplete VIN before saving", async () => {
    const page = await browser.newPage();
    try {
      await openFixture(page, "?fail=1");
      await page
        .getByRole("button", { name: "Edit saved search Future donor" })
        .click();
      await page
        .getByRole("radio", { name: "VIN pattern", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "VIN pattern", exact: true })
        .fill("YV4");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "complete 17-position VIN" })
        .waitFor();
      expect(await page.locator("#submission").textContent()).toBe("null");
      await page.getByRole("radio", { name: "Keywords", exact: true }).click();
      expect(
        await page
          .getByLabel("All of these words", { exact: true })
          .inputValue(),
      ).toBe("wagon");
      await page
        .getByRole("radio", { name: "VIN pattern", exact: true })
        .click();
      expect(
        await page
          .getByRole("textbox", { name: "VIN pattern", exact: true })
          .inputValue(),
      ).toBe("YV4");
      await page
        .getByRole("textbox", { name: "VIN pattern", exact: true })
        .fill("YV4C*85**********");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "The save failed" })
        .waitFor();
      expect(
        await page
          .getByRole("textbox", { name: "VIN pattern", exact: true })
          .inputValue(),
      ).toBe("YV4C*85**********");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "Edit saved search Future donor" })
        .click();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    } finally {
      await page.close();
    }
  });

  test("edits a VIN search from Settings without replacing the VIN with keywords", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    try {
      await openFixture(page, "?settings=1&vin=1&query=");
      for (const name of [
        "Searches",
        "Notifications",
        "Plan and billing",
        "Account",
      ]) {
        expect(
          await page
            .getByRole("navigation", { name: "Settings" })
            .getByRole("link", { name, exact: true })
            .isVisible(),
        ).toBe(true);
      }
      expect(
        await page
          .getByRole("link", { name: "New search", exact: true })
          .getAttribute("href"),
      ).toBe("/search?advanced=1");
      await page
        .getByRole("button", { name: "Edit saved search Future donor" })
        .click();
      expect(
        await page
          .getByRole("textbox", { name: "VIN pattern", exact: true })
          .inputValue(),
      ).toBe("YV4C*85**********");
      await page.getByLabel("Search name", { exact: true }).fill("VIN donor");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      expect(await page.locator("#submission").textContent()).toContain(
        '"vinPattern":"YV4C*85**********"',
      );
      expect(await page.locator("#submission").textContent()).toContain(
        '"query":""',
      );
    } finally {
      await page.close();
    }
  });
});
