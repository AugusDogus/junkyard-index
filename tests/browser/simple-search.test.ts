// The default search page: a clean URL, one toolbar row, and every other
// control inside Filters. Active choices show as removable chips.
import { afterAll, beforeAll, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Browser, Page } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";
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
      .then(async (source) => {
        const result = await postcss([tailwind()]).process(source, {
          from: "src/styles/globals.css",
        });
        return result.css;
      }),
  ]);
  browser = await launchBrowser();
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

async function open(
  page: Page,
  search: string,
  ready: "results" | "chips" = "results",
) {
  page.setDefaultTimeout(10_000);
  await page.route("http://shared-search.test/**", async (route) => {
    const url = new URL(route.request().url());
    const isScript = url.pathname === "/app.js";
    return route.fulfill({
      contentType: isScript ? "text/javascript" : "text/html",
      body: isScript ? script : await renderSharedSearchFixture(url.search),
    });
  });
  await page.goto(`http://shared-search.test/search${search}`);
  await page.addStyleTag({ content: stylesheet });
  // next/font defines the font in the app. The padding stands in for the site
  // header the sticky toolbar sits under, so the toolbar covers nothing.
  await page.addStyleTag({
    content: ":root{--font-brand:ui-monospace}body{padding-top:6.375rem}",
  });
  await (
    ready === "results"
      ? page.getByRole("heading", { name: /^[\d,]+ vehicles?$/ })
      : page.getByRole("group", { name: "Active filters" })
  ).waitFor();
}

/** Lets pending router and nuqs URL writes land. */
async function settle(page: Page) {
  await page.waitForTimeout(500);
}

const urlSearch = (page: Page) => new URL(page.url()).search;

async function openFilters(page: Page) {
  // The desktop panel stays open until its toggle closes it.
  if (await page.getByRole("group", { name: "Arrival window" }).isVisible())
    return;
  await page.getByRole("button", { name: /^Filters/ }).click();
  await page.getByRole("group", { name: "Arrival window" }).waitFor();
}

/** Phones edit filters in a drawer; close it to reach the page again. */
async function closeFilters(page: Page, width: number) {
  if (width < 768) {
    await page
      .getByRole("button", { name: /^Show (results|[\d,]+ vehicles?)$/ })
      .click();
    await page
      .getByRole("dialog", { name: "Filters" })
      .waitFor({ state: "detached" });
  }
}

for (const viewport of VIEWPORTS) {
  test(`the default search keeps a clean URL and starts results on the first screen: ${viewport.width}px`, async () => {
    const page = await createPage(browser, { viewport });
    try {
      await open(page, "");
      await settle(page);
      expect(urlSearch(page)).toBe("");
      expect(
        await page.getByRole("button", { name: /^Filters/ }).textContent(),
      ).toBe("Filters");
      for (const name of ["Arrival window", "Yard type", "Active filters"])
        expect(await page.getByRole("group", { name }).count()).toBe(0);
      expect(
        await page.getByRole("button", { name: "Advanced search" }).count(),
      ).toBe(0);
      expect(
        await page.getByRole("combobox", { name: "Distance radius" }).count(),
      ).toBe(0);
      expect(await page.getByText(/Results in \d+ ms/).count()).toBe(0);
      const firstCard = await page.locator("h3").first().boundingBox();
      expect(firstCard).not.toBeNull();
      expect((firstCard?.y ?? Infinity) < viewport.height).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await closePage(page);
    }
  }, 30_000);

  test(`filters move into the panel and show as removable chips: ${viewport.width}px`, async () => {
    const page = await createPage(browser, { viewport });
    try {
      await open(page, "");
      await openFilters(page);
      for (const name of ["Arrival window", "Yard type"])
        expect(await page.getByRole("group", { name }).count()).toBe(1);
      expect(
        await page.getByRole("combobox", { name: "Distance radius" }).count(),
      ).toBe(1);
      expect(
        await page.getByRole("button", { name: /^Advanced search/ }).count(),
      ).toBe(1);
      // Arrival and yard type share one toggle style, sized alike, and no
      // toggle clips its label.
      const toggles = await page
        .getByRole("group", { name: /^(Arrival window|Yard type)$/ })
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => ({
            name: button.textContent,
            pressed: button.getAttribute("aria-pressed"),
            fontSize: getComputedStyle(button).fontSize,
            // Layout height: the drawer may still be animating its transform.
            height: button instanceof HTMLElement ? button.offsetHeight : 0,
            fits: button.scrollWidth <= button.clientWidth,
          })),
        );
      expect(toggles.map((toggle) => toggle.name)).toEqual([
        "Any arrival date",
        "Last 24 hours",
        "Last 48 hours",
        "Last 7 days",
        "All yards",
        "Self-service",
        "Full-service",
      ]);
      expect(toggles.every((toggle) => toggle.fits)).toBe(true);
      expect(new Set(toggles.map((toggle) => toggle.fontSize)).size).toBe(1);
      expect(new Set(toggles.map((toggle) => toggle.height)).size).toBe(1);
      expect(toggles.filter((toggle) => toggle.pressed === "true")).toEqual([
        expect.objectContaining({ name: "Any arrival date" }),
        expect.objectContaining({ name: "Self-service" }),
      ]);
      await page
        .getByRole("button", { name: "Last 7 days", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Full-service", exact: true })
        .click();
      await page.waitForFunction(() => {
        const params = new URL(location.href).searchParams;
        return (
          params.get("arrivalWindow[]") === "7d" &&
          params.getAll("yardTypes[]").length === 2
        );
      });
      await closeFilters(page, viewport.width);
      const chips = page.getByRole("group", { name: "Active filters" });
      await chips
        .getByRole("button", { name: "Remove Last 7 days", exact: true })
        .waitFor();
      expect(
        await chips
          .getByRole("button", {
            name: "Remove Full-service included",
            exact: true,
          })
          .count(),
      ).toBe(1);
      expect(
        await page
          .getByRole("button", { name: /^Filters/ })
          .first()
          .textContent(),
      ).toBe("Filters(2)");
      // The chips stay on one line above the results.
      const chipTops = await chips
        .getByRole("button")
        .evaluateAll((buttons) =>
          buttons.map((button) => button.getBoundingClientRect().top),
        );
      expect(new Set(chipTops).size).toBe(1);
      await chips
        .getByRole("button", { name: "Remove Last 7 days", exact: true })
        .click();
      await page.waitForFunction(
        () => !new URL(location.href).searchParams.has("arrivalWindow[]"),
      );
      await settle(page);
      expect(
        await chips.getByRole("button", { name: /^Remove / }).count(),
      ).toBe(1);
      // One chip clears with its own x.
      expect(
        await chips.getByRole("button", { name: "Clear all" }).count(),
      ).toBe(0);
      await openFilters(page);
      await page
        .getByRole("button", { name: "Last 7 days", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          new URL(location.href).searchParams.get("arrivalWindow[]") === "7d",
      );
      if (viewport.width < 768) {
        // Phones clear everything from the drawer.
        await page
          .getByRole("dialog", { name: "Filters" })
          .getByRole("button", { name: "Clear all", exact: true })
          .click();
        await page.waitForFunction(() => location.search === "");
        await closeFilters(page, viewport.width);
      } else {
        await chips
          .getByRole("button", { name: "Clear all", exact: true })
          .click();
      }
      await page.waitForFunction(() => location.search === "");
      await settle(page);
      expect(urlSearch(page)).toBe("");
      expect(
        await page.getByRole("group", { name: "Active filters" }).count(),
      ).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await closePage(page);
    }
  }, 30_000);

  // Safari throws once a page writes history 100 times in 10 seconds, and a
  // drag across the Year slider passes through over 100 years.
  test(`dragging the Year slider writes one history entry: ${viewport.width}px`, async () => {
    const page = await createPage(browser, { viewport });
    try {
      await page.addInitScript(() => {
        const writes: string[] = [];
        Reflect.set(window, "historyWrites", writes);
        for (const method of ["pushState", "replaceState"] as const) {
          const write = History.prototype[method];
          History.prototype[method] = function (
            this: History,
            ...args: Parameters<History["pushState"]>
          ) {
            writes.push(`${method} ${String(args[2])}`);
            write.apply(this, args);
          };
        }
      });
      const historyWrites = () =>
        page.evaluate(() => {
          const writes: unknown = Reflect.get(window, "historyWrites");
          return Array.isArray(writes) ? writes.map(String) : [];
        });
      await open(page, "?q=volvo&yardTypes=all");
      await openFilters(page);
      if (viewport.width >= 768)
        await page.getByRole("button", { name: "Year", exact: true }).click();
      const latest = page.getByRole("slider").nth(1);
      await latest.scrollIntoViewIfNeeded();
      await settle(page);
      const start = new URL(page.url());
      const startYear = await page.locator("output").nth(1).textContent();
      const before = await page.evaluate(() => window.history.length);
      const written = (await historyWrites()).length;
      const thumb = await latest.boundingBox();
      const track = await page.locator("[data-slot=slider]").boundingBox();
      if (!thumb || !track) throw new Error("The Year slider is not visible.");
      const y = thumb.y + thumb.height / 2;
      await page.mouse.move(thumb.x + thumb.width / 2, y);
      await page.mouse.down();
      const shown = new Set<string | null>();
      for (let step = 1; step <= 40; step++) {
        await page.mouse.move(
          thumb.x + thumb.width / 2 - (step * track.width) / 80,
          y,
        );
        shown.add(await page.locator("output").nth(1).textContent());
      }
      // Record every year shown after release, to catch a snap back.
      await page
        .locator("output")
        .nth(1)
        .evaluate((output) => {
          const seen: string[] = [];
          Reflect.set(window, "releasedYears", seen);
          new MutationObserver(() => seen.push(output.textContent)).observe(
            output,
            { characterData: true, childList: true, subtree: true },
          );
        });
      await page.mouse.up();
      await settle(page);
      const releasedYears = await page.evaluate(() => {
        const seen: unknown = Reflect.get(window, "releasedYears");
        return Array.isArray(seen) ? seen.map(String) : [];
      });
      // The slider still follows the drag year by year.
      expect(shown.size).toBeGreaterThan(20);
      const maxYear = Number(new URL(page.url()).searchParams.get("maxYear"));
      expect(maxYear).toBeLessThan(2000);
      expect(await page.locator("output").nth(1).textContent()).toBe(
        String(maxYear),
      );
      expect(releasedYears.every((year) => year === String(maxYear))).toBe(
        true,
      );
      expect((await historyWrites()).slice(written)).toEqual([
        `pushState ${page.url()}`,
      ]);
      expect(await page.evaluate(() => window.history.length)).toBe(before + 1);
      await page.goBack();
      await page.waitForFunction((href) => location.href === href, start.href);
      await settle(page);
      // Back restores the range from before the drag, not the dragged one.
      expect(await page.locator("output").nth(1).textContent()).toBe(startYear);
    } finally {
      await closePage(page);
    }
  }, 30_000);

  // A system gesture can cancel a touch drag, and then no release applies it.
  test(`a cancelled Year slider drag shows the applied range again: ${viewport.width}px`, async () => {
    const page = await createPage(browser, { viewport });
    try {
      await open(page, "?q=volvo&yardTypes=all");
      await openFilters(page);
      if (viewport.width >= 768)
        await page.getByRole("button", { name: "Year", exact: true }).click();
      const latest = page.getByRole("slider").nth(1);
      await latest.scrollIntoViewIfNeeded();
      await settle(page);
      const start = page.url();
      const startYear = await page.locator("output").nth(1).textContent();
      const thumb = await latest.boundingBox();
      const track = await page.locator("[data-slot=slider]").boundingBox();
      if (!thumb || !track) throw new Error("The Year slider is not visible.");
      const y = thumb.y + thumb.height / 2;
      await page.mouse.move(thumb.x + thumb.width / 2, y);
      await page.mouse.down();
      await page.mouse.move(thumb.x + thumb.width / 2 - track.width / 4, y);
      expect(await page.locator("output").nth(1).textContent()).not.toBe(
        startYear,
      );
      await latest.dispatchEvent("pointercancel", { pointerId: 1 });
      await settle(page);
      expect(await page.locator("output").nth(1).textContent()).toBe(startYear);
      expect(await latest.getAttribute("aria-valuenow")).toBe(startYear);
      expect(page.url()).toBe(start);
      await page.mouse.up();
    } finally {
      await closePage(page);
    }
  }, 30_000);
}

test("legacy self-service links keep the default scope without a chip", async () => {
  const page = await createPage(browser);
  try {
    await open(page, "?yardTypes%5B%5D=self_service");
    expect(
      await page.getByRole("group", { name: "Active filters" }).count(),
    ).toBe(0);
    expect(
      await page.getByRole("button", { name: /^Filters/ }).textContent(),
    ).toBe("Filters");
    await openFilters(page);
    expect(
      await page
        .getByRole("button", { name: "Self-service", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  } finally {
    await closePage(page);
  }
}, 30_000);

test("the free New near me link lands on an arrival-filtered search", async () => {
  const page = await createPage(browser, {
    viewport: { width: 390, height: 844 },
  });
  try {
    // The homepage link carries no location, so the page asks for one.
    await open(
      page,
      "?arrivalWindow%5B%5D=7d&radius=50&fixtureGuest=1",
      "chips",
    );
    const chips = page.getByRole("group", { name: "Active filters" });
    for (const name of ["Remove Last 7 days", "Remove Within 50 mi"])
      await chips.getByRole("button", { name, exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Choose location", exact: true })
      .click();
    await page.getByRole("dialog", { name: "Distance Location" }).waitFor();
    await page.keyboard.press("Escape");
    // The arrival view opens from the drawer too, with the window selected.
    await openFilters(page);
    expect(
      await page
        .getByRole("button", { name: "Last 7 days", exact: true })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  } finally {
    await closePage(page);
  }
}, 30_000);

test("All yards shows every yard's results beside its chip", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1440, height: 900 },
  });
  try {
    await open(page, "");
    await openFilters(page);
    await page
      .getByRole("button", {
        name: "All yards, including unclassified",
        exact: true,
      })
      .click();
    await page.waitForFunction(() => {
      const params = new URL(location.href).searchParams;
      return (
        [
          ...params.getAll("yardTypes"),
          ...params.getAll("yardTypes[]"),
        ].join() === "all"
      );
    });
    const chips = page.getByRole("group", { name: "Active filters" });
    await chips
      .getByRole("button", { name: "Remove All yards", exact: true })
      .waitFor();
    // Every fixture vehicle, unclassified yards included.
    await page
      .getByRole("heading", { name: "10 vehicles", exact: true })
      .waitFor();
    expect(
      await page.getByRole("heading", { name: "Try a search" }).count(),
    ).toBe(0);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("the Filters panel groups Advanced search last with one quiet upsell line", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1440, height: 900 },
  });
  try {
    await open(page, "?fixturePlan=free");
    await openFilters(page);
    const panel = page.getByRole("region", { name: "Filters" });
    const tops = await Promise.all(
      ["Arrived", "Distance", "Yard type", "More filters", "Advanced"].map(
        async (label) =>
          (await panel.getByText(label, { exact: true }).boundingBox())?.y ??
          Number.NaN,
      ),
    );
    expect(tops).toEqual([...tops].sort((left, right) => left - right));
    expect(
      await panel
        .getByRole("button", { name: "Advanced search, upgrade required" })
        .count(),
    ).toBe(1);
    expect(await panel.getByRole("button", { name: "Clear" }).count()).toBe(0);
    expect(await panel.getByText("Filter the full inventory").count()).toBe(0);
    expect(
      await panel.getByRole("link", { name: "Compare plans" }).count(),
    ).toBe(1);
  } finally {
    await closePage(page);
  }
}, 30_000);

test("paid Year sits in one row with the other filters", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1440, height: 900 },
  });
  try {
    await open(page, "");
    await openFilters(page);
    const panel = page.getByRole("region", { name: "Filters" });
    const tops = await Promise.all(
      ["Year", "Make", "Inventory sources"].map(async (name) => {
        const box = await panel
          .getByRole("button", { name, exact: true })
          .boundingBox();
        return box?.y;
      }),
    );
    expect(new Set(tops).size).toBe(1);
  } finally {
    await closePage(page);
  }
}, 30_000);

for (const width of [320, 360, 390])
  for (const filters of ["none", "two"] as const)
    test(`a signed-in toolbar keeps four distinct, legible controls on one row: ${width}px, ${filters} filters`, async () => {
      const page = await createPage(browser, {
        viewport: { width, height: 844 },
      });
      try {
        await open(
          page,
          filters === "none"
            ? "?fixtureSaved=1"
            : "?fixtureSaved=1&yardTypes=all&minYear=2010",
        );
        const save = page.getByRole("button", { name: "Save search" });
        const saved = page.getByRole("button", {
          name: "Open 1 saved searches",
        });
        await saved.waitFor();
        // Different glyphs, and the saved count stays visible.
        expect(await save.locator("svg").getAttribute("class")).toContain(
          "lucide-bookmark-plus",
        );
        expect(await saved.locator("svg").getAttribute("class")).toContain(
          "lucide-list",
        );
        expect((await saved.innerText()).trim()).toBe("1");
        const controls = [
          page.getByRole("button", { name: /^Filters/ }),
          page.getByRole("combobox", { name: /^Sort vehicles/ }),
          save,
          saved,
        ];
        const boxes = await Promise.all(
          controls.map((control) => control.boundingBox()),
        );
        expect(new Set(boxes.map((box) => box?.y)).size).toBe(1);
        // Natural widths leave headroom, since CI's fallback font is wider.
        const natural = await Promise.all(
          controls.map((control) =>
            control.evaluate(
              // Content and padding, plus the borders.
              (element) => {
                const style = getComputedStyle(element);
                return (
                  element.scrollWidth +
                  Number.parseFloat(style.borderLeftWidth) +
                  Number.parseFloat(style.borderRightWidth)
                );
              },
            ),
          ),
        );
        const row = await page.evaluate(() => {
          const search = document.getElementById("search");
          return search?.closest(".sticky")?.querySelector(".flex.w-full")
            ?.clientWidth;
        });
        const used = natural.reduce((sum, width) => sum + width, 0) + 3 * 6;
        expect((row ?? 0) - used).toBeGreaterThanOrEqual(16);
        // No control clips its own label.
        for (const control of controls)
          expect(
            await control.evaluate(
              (element) => element.scrollWidth <= element.clientWidth,
            ),
          ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      } finally {
        await closePage(page);
      }
    }, 30_000);

test("the homepage New near me link names the visitor's ZIP, not a saved search", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1440, height: 900 },
  });
  try {
    await page.addInitScript(() =>
      localStorage.setItem(
        "junkyard-index:location-preference",
        JSON.stringify({
          mode: "zip",
          zipCode: "32571",
          lat: 30.4,
          lng: -87.2,
        }),
      ),
    );
    // The link HomeSearchHero builds from that preference.
    await open(
      page,
      "?arrivalWindow%5B%5D=7d&lat=30.4&lng=-87.2&radius=50",
      "chips",
    );
    await page
      .getByRole("group", { name: "Active filters" })
      .getByRole("button", {
        name: "Remove Within 50 mi of 32571",
        exact: true,
      })
      .waitFor();
    await openFilters(page);
    expect(
      await page
        .getByRole("button", { name: "ZIP 32571", exact: true })
        .count(),
    ).toBe(1);
  } finally {
    await closePage(page);
  }
}, 30_000);
