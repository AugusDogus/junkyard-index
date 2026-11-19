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
  page.setDefaultTimeout(5_000);
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

const workspace = (page: Page) =>
  page.getByRole("form", { name: "Saved search workspace" });

async function openEditor(page: Page, name = "Future donor") {
  const link = page.getByRole("link", {
    name: `Edit saved search ${name}`,
    exact: true,
  });
  expect(await link.getAttribute("href")).toMatch(
    /^\/saved-searches\/[^/]+\/edit\?from=(search|settings)$/,
  );
  await link.click();
  await workspace(page).waitFor();
}

async function saveChanges(page: Page) {
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await workspace(page).waitFor({ state: "hidden" });
}

async function addFilter(page: Page, name: string) {
  await page.getByRole("button", { name: "Add filter", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
}

async function addColor(page: Page) {
  await addFilter(page, "Color");
  await page
    .getByRole("combobox", { name: "Add Color value", exact: true })
    .fill("Purple");
  await page.getByRole("option", { name: "Use “Purple”", exact: true }).click();
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

async function submission(page: Page): Promise<unknown> {
  const text = await page.locator("#submission").textContent();
  if (!text)
    throw new Error(
      "The saved-search fixture did not render its submission receipt.",
    );
  return JSON.parse(text);
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
        await openEditor(page);
        const expression = page.getByRole("textbox", {
          name: "Search expression",
          exact: true,
        });
        expect(await expression.inputValue()).toBe(
          'wagon AND "roof rack" AND !diesel AND (volvo OR saab) AND year:>=1980 AND year:<=2000 AND make:Saab',
        );
        await page
          .getByLabel("Search name", { exact: true })
          .fill("Future wagon");
        await expression.fill(
          'wagon "roof rack" (Volvo OR Saab) !diesel !damaged make:Qvale year:>=1980 year:<=2000',
        );
        await page
          .getByRole("combobox", { name: "Sort results", exact: true })
          .click();
        await page
          .getByRole("option", { name: "Oldest First", exact: true })
          .click();
        await expectNoOverflow(page);
        await saveChanges(page);
        expect(await submission(page)).toEqual({
          path: "savedSearches.update",
          input: {
            id: "saved-volvo",
            name: "Future wagon",
            query: "",
            filters: {
              expression:
                'wagon "roof rack" (Volvo OR Saab) !diesel !damaged make:Qvale year:>=1980 year:<=2000',
              sortBy: "oldest",
            },
          },
        });
        await openEditor(page, "Future wagon");
        expect(await expression.inputValue()).toBe(
          'wagon "roof rack" (Volvo OR Saab) !diesel !damaged make:Qvale year:>=1980 year:<=2000',
        );
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
        await addColor(page);
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
            .getByRole("button", { name: "Remove Purple", exact: true })
            .count(),
        ).toBe(1);
        await page
          .getByRole("button", { name: "Save search", exact: true })
          .click();
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        expect(await submission(page)).toEqual({
          path: "savedSearches.create",
          input: {
            name: "Waiting for a Saab",
            query: "",
            filters: expect.objectContaining({
              makes: ["Saab"],
              colors: ["Purple"],
            }),
            emailAlertsEnabled: false,
            discordAlertsEnabled: false,
          },
        });
      } finally {
        await page.close();
      }
    }, 20_000);
  }

  for (const width of [390, 1440]) {
    test(`starts simple and reveals advanced criteria and new filters at ${width}px`, async () => {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      try {
        await openFixture(page, "?query=volvo&no-suggestions=1");
        await openEditor(page);
        expect(
          await page
            .getByRole("textbox", { name: "Search terms", exact: true })
            .inputValue(),
        ).toBe("volvo");
        expect(
          await page
            .getByRole("button", { name: "Basic search", exact: true })
            .getAttribute("aria-pressed"),
        ).toBe("true");
        expect(
          await page
            .getByRole("textbox", { name: "Search expression", exact: true })
            .count(),
        ).toBe(0);
        await page
          .getByRole("button", { name: "MakeSaab", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Remove Saab", exact: true })
          .click();
        const make = page.getByRole("combobox", {
          name: "Add Make value",
          exact: true,
        });
        await make.fill("  Qvale  ");
        await make.press("Enter");
        expect(await workspace(page).count()).toBe(1);
        expect(
          await page
            .getByRole("option", { name: "Use “Qvale”", exact: true })
            .count(),
        ).toBe(0);
        expect(
          await page
            .getByRole("button", { name: "Remove Qvale", exact: true })
            .count(),
        ).toBe(1);
        await page.getByRole("button", { name: "Done", exact: true }).click();
        await addColor(page);
        await page
          .getByRole("button", { name: "Advanced search", exact: true })
          .click();
        const expression = page.getByRole("textbox", {
          name: "Search expression",
          exact: true,
        });
        expect(await expression.inputValue()).toBe(
          "volvo AND year:>=1980 AND year:<=2000 AND make:Qvale AND color:Purple",
        );
        await expression.fill(`${await expression.inputValue()} AND !diesel`);
        await saveChanges(page);
        expect(await submission(page)).toEqual(
          expect.objectContaining({
            input: expect.objectContaining({
              query: "",
              filters: expect.objectContaining({
                expression:
                  "volvo AND year:>=1980 AND year:<=2000 AND make:Qvale AND color:Purple AND !diesel",
              }),
            }),
          }),
        );
        await openEditor(page);
        expect(await expression.inputValue()).toContain(
          "color:Purple AND !diesel",
        );
        expect(
          await page
            .getByRole("button", { name: "Advanced search", exact: true })
            .getAttribute("aria-pressed"),
        ).toBe("true");
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
          const firstAlerts = first.getByRole("button", {
            name: "Alerts for Future donor: Email",
            exact: true,
          });
          await firstAlerts.waitFor();
          await second
            .getByRole("button", { name: /Alerts for Tacoma.*: Discord/ })
            .waitFor();
          expect(await page.getByRole("switch").count()).toBe(0);
          expect(
            await page
              .getByRole("button", { name: /Delete saved search/ })
              .count(),
          ).toBe(0);
          await openEditor(page);
          expect(new URL(page.url()).searchParams.get("from")).toBe(
            settings ? "settings" : "search",
          );
          const email = page.getByRole("switch", {
            name: "Email alerts for Future donor",
            exact: true,
          });
          const discord = page.getByRole("switch", {
            name: "Discord alerts for Future donor",
            exact: true,
          });
          expect(await email.isChecked()).toBe(true);
          expect(await discord.isChecked()).toBe(false);
          await email.click();
          await discord.click();
          expect(await submission(page)).toBeNull();
          await page
            .getByRole("button", { name: "Cancel", exact: true })
            .click();
          await firstAlerts.waitFor();
          expect(new URL(page.url()).pathname).toBe(
            settings ? "/settings/searches" : "/search",
          );
          await openEditor(page);
          expect(await email.isChecked()).toBe(true);
          expect(await discord.isChecked()).toBe(false);
          await email.click();
          await discord.click();
          await page
            .getByLabel("Search name", { exact: true })
            .fill("Updated donor");
          await expectNoOverflow(page);
          await saveChanges(page);
          await page
            .getByRole("article", { name: "Updated donor", exact: true })
            .getByRole("button", {
              name: "Alerts for Updated donor: Discord",
              exact: true,
            })
            .waitFor();
          await second
            .getByRole("button", { name: /Alerts for Tacoma.*: Discord/ })
            .waitFor();
          expect(await submission(page)).toEqual(
            expect.objectContaining({
              path: "savedSearches.update",
              input: expect.objectContaining({
                name: "Updated donor",
                emailAlertsEnabled: false,
                discordAlertsEnabled: true,
              }),
            }),
          );
          await expectNoOverflow(page);
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
        await openEditor(page);
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
        await workspace(page).waitFor({ state: "hidden" });
        await page
          .getByRole("article", {
            name: "Tacoma donor with a particularly long saved search name",
            exact: true,
          })
          .waitFor();
        expect(
          await page
            .getByRole("article", { name: "Future donor", exact: true })
            .count(),
        ).toBe(0);
        expect(await page.getByRole("article").count()).toBe(1);
        expect(await submission(page)).toEqual({
          path: "savedSearches.delete",
          input: { id: "saved-volvo" },
        });
      } finally {
        await page.close();
      }
    }, 20_000);
  }

  test("opens scoped quick alerts from the inline bell and edits channels independently", async () => {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    try {
      await openFixture(page, "?scene=1&multiple=1&discord=1");
      await page
        .getByRole("button", {
          name: "Alerts for Future donor: Email",
          exact: true,
        })
        .click();
      const popover = page.getByRole("dialog", {
        name: "Alerts for this search",
        exact: true,
      });
      await popover.waitFor();
      const email = popover.getByRole("switch", {
        name: "Email alerts for Future donor",
        exact: true,
      });
      expect(await email.isChecked()).toBe(true);
      await email.click();
      await page
        .getByRole("button", {
          name: "Alerts for Future donor: Off",
          exact: true,
        })
        .waitFor();
      expect(await submission(page)).toEqual({
        path: "savedSearches.toggleEmailAlerts",
        input: { id: "saved-volvo", enabled: false },
      });
      await popover
        .getByRole("switch", {
          name: "Discord alerts for Future donor",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", {
          name: "Alerts for Future donor: Discord",
          exact: true,
        })
        .waitFor();
      expect(await submission(page)).toEqual({
        path: "savedSearches.toggleDiscordAlerts",
        input: { id: "saved-volvo", enabled: true },
      });
      await page
        .getByRole("article", {
          name: "Tacoma donor with a particularly long saved search name",
          exact: true,
        })
        .getByRole("button", { name: /Alerts for Tacoma.*: Discord/ })
        .waitFor();
      await page.keyboard.press("Escape");
      await popover.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "Honda Civic Make + model" })
        .waitFor();
      expect(
        await page
          .getByRole("link", { name: "Edit saved search Future donor" })
          .locator("svg")
          .count(),
      ).toBe(1);
    } finally {
      await page.close();
    }
  }, 20_000);

  test("preserves both drafts through notification setup and a failed combined save", async () => {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    try {
      await openFixture(page, "?discord=1&fail=1");
      const open = page.getByRole("link", {
        name: "Open saved search Future donor",
      });
      await open.waitFor();
      expect((await open.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await openEditor(page);
      await page
        .getByLabel("Search name", { exact: true })
        .fill("My new donor");
      const discord = page.getByRole("switch", {
        name: "Discord alerts for My new donor",
        exact: true,
      });
      await discord.click();
      const popupPromise = page.waitForEvent("popup");
      await page
        .getByRole("link", {
          name: "Notification setup (new tab)",
          exact: true,
        })
        .click();
      const popup = await popupPromise;
      await popup.close();
      expect(await workspace(page).count()).toBe(1);
      expect(await discord.isChecked()).toBe(true);
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "The save failed" })
        .waitFor();
      expect(
        await page.getByLabel("Search name", { exact: true }).inputValue(),
      ).toBe("My new donor");
      expect(await discord.isChecked()).toBe(true);
      await saveChanges(page);
      await page
        .getByRole("article", { name: "My new donor", exact: true })
        .getByRole("button", {
          name: "Alerts for My new donor: Email and Discord",
          exact: true,
        })
        .waitFor();
    } finally {
      await page.close();
    }
  }, 20_000);

  test("keeps a failed deletion open with recovery and preserves the search", async () => {
    const page = await browser.newPage();
    try {
      await openFixture(page, "?fail=1");
      await openEditor(page);
      await page
        .getByRole("button", { name: "Delete saved search Future donor" })
        .click();
      const confirmation = page.getByRole("alertdialog");
      await confirmation
        .getByRole("button", { name: "Delete search", exact: true })
        .click();
      await confirmation.getByRole("alert").waitFor();
      expect(await submission(page)).toBeNull();
      await confirmation
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await confirmation.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page
        .getByRole("article", { name: "Future donor", exact: true })
        .waitFor();
      await openEditor(page);
      await page
        .getByRole("button", { name: "Delete saved search Future donor" })
        .click();
      await confirmation
        .getByRole("button", { name: "Delete search", exact: true })
        .click();
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
      await openEditor(page);
      const expression = page.getByRole("textbox", {
        name: "Search expression",
        exact: true,
      });
      const original = await expression.inputValue();
      expect(original).toBe(
        '"crew cab" AND (ford OR ram) AND (diesel OR gasoline) AND year:>=1980 AND year:<=2000 AND make:Saab',
      );
      await expression.fill("Ford OR");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await workspace(page)
        .getByRole("alert")
        .filter({ hasText: "Put a condition on both sides of AND or OR." })
        .waitFor();
      expect(await expression.getAttribute("aria-invalid")).toBe("true");
      expect(await submission(page)).toBeNull();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await openEditor(page);
      expect(await expression.inputValue()).toBe(original);
      await saveChanges(page);
      expect(await submission(page)).toEqual(
        expect.objectContaining({ input: expect.objectContaining({ query }) }),
      );
    } finally {
      await page.close();
    }
  }, 20_000);

  test("keeps mode drafts and rejects an incomplete VIN before saving", async () => {
    const page = await browser.newPage();
    try {
      await openFixture(page, "?fail=1");
      await openEditor(page);
      const expression = page.getByRole("textbox", {
        name: "Search expression",
        exact: true,
      });
      const original = await expression.inputValue();
      await page
        .getByRole("button", { name: "VIN search", exact: true })
        .click();
      const vin = page.getByRole("textbox", {
        name: "VIN pattern",
        exact: true,
      });
      await vin.fill("YV4");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "complete 17-position VIN" })
        .waitFor();
      expect(await submission(page)).toBeNull();
      await page
        .getByRole("button", { name: "Advanced search", exact: true })
        .click();
      expect(await expression.inputValue()).toBe(original);
      await page
        .getByRole("button", { name: "VIN search", exact: true })
        .click();
      expect(await vin.inputValue()).toBe("YV4");
      await vin.fill("YV4C*85**********");
      await page
        .getByRole("button", { name: "Save changes", exact: true })
        .click();
      await page
        .getByRole("alert")
        .filter({ hasText: "The save failed" })
        .waitFor();
      expect(await vin.inputValue()).toBe("YV4C*85**********");
      await saveChanges(page);
      expect(await submission(page)).toEqual(
        expect.objectContaining({
          input: expect.objectContaining({
            query: "",
            filters: expect.objectContaining({
              vinPattern: "YV4C*85**********",
            }),
          }),
        }),
      );
      await openEditor(page);
      expect(await vin.inputValue()).toBe("YV4C*85**********");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await workspace(page).waitFor({ state: "hidden" });
    } finally {
      await page.close();
    }
  }, 20_000);

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
      await openEditor(page);
      expect(
        await page
          .getByRole("textbox", { name: "VIN pattern", exact: true })
          .inputValue(),
      ).toBe("YV4C*85**********");
      await page.getByLabel("Search name", { exact: true }).fill("VIN donor");
      await saveChanges(page);
      expect(await submission(page)).toEqual(
        expect.objectContaining({
          input: expect.objectContaining({
            name: "VIN donor",
            query: "",
            filters: expect.objectContaining({
              vinPattern: "YV4C*85**********",
            }),
          }),
        }),
      );
      expect(new URL(page.url()).pathname).toBe("/settings/searches");
    } finally {
      await page.close();
    }
  }, 20_000);
});
