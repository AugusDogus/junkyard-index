import { afterAll, beforeAll, expect, test } from "bun:test";
import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import type { Browser, Page } from "playwright-core";
import { closePage, createPage, launchBrowser } from "./browser-page";

let browser: Browser;
let script: string;
let stylesheet: string;

beforeAll(async () => {
  const build = await Bun.build({
    entrypoints: ["tests/browser/fixtures/yard-map.tsx"],
    target: "browser",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const output = build.outputs[0];
  if (!build.success || !output) throw new Error(build.logs.join("\n"));
  script = await output.text();
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
});

const BLANK_TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** Serve the fixture app; `located` holds the visitor-location reply. */
async function serveFixture(page: Page, located: Promise<void>) {
  await page.route("http://yard-map.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/app.js")
      return route.fulfill({ contentType: "text/javascript", body: script });
    if (path === "/app.css")
      return route.fulfill({ contentType: "text/css", body: stylesheet });
    if (path === "/api/visitor-location") {
      await located;
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ location: { lat: 25, lng: -97 } }),
      });
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><script>globalThis.process={env:{NODE_ENV:"production"}}</script><script type="module" src="/app.js"></script></body></html>`,
    });
  });
  await page.route(/^https?:\/\/(?!yard-map\.test)/, (route) => route.abort());
  // Blank tiles, so map moves that wait for their tiles can finish.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: BLANK_TILE }),
  );
}

test("the approximate location re-sorts the directory without losing scroll or focus", async () => {
  // Below the desktop width the location controls, and their account lookup,
  // stay unloaded, so only the IP location sorts the directory.
  const page = await createPage(browser, {
    viewport: { width: 390, height: 844 },
  });
  try {
    page.setDefaultTimeout(5_000);
    let sendLocation = () => {};
    const located = new Promise<void>((resolve) => {
      sendLocation = resolve;
    });
    await serveFixture(page, located);
    await page.goto("http://yard-map.test/");

    await page.getByRole("button", { name: "Browse" }).click();
    const list = page.getByRole("list", { name: "Yard directory results" });
    await list.getByRole("button", { name: /^Yard 0\b/ }).focus();
    for (let step = 0; step < 5; step++) await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() =>
      document.activeElement?.textContent?.startsWith("Yard 5"),
    );
    // Marks this list element; a remounted directory would be a new one.
    const scrolled = await list.evaluate((element) => {
      element.setAttribute("data-before-location", "");
      return element.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);

    sendLocation();
    // Nearest the southern location, Yard 39 now leads the list.
    await page.waitForFunction(
      () =>
        document
          .querySelector('[aria-posinset="1"]')
          ?.textContent?.startsWith("Yard 39") ?? false,
    );
    expect(
      await page.evaluate(() =>
        document.activeElement?.textContent?.startsWith("Yard 5"),
      ),
    ).toBe(true);
    // The same list, not back at the top. The virtualizer nudges the offset
    // by the difference between measured and estimated row heights above it.
    expect(
      await list.evaluate((element) => ({
        same: element.hasAttribute("data-before-location"),
        scrolled: element.scrollTop > 0,
      })),
    ).toEqual({ same: true, scrolled: true });
  } finally {
    await closePage(page);
  }
}, 20_000);

test("the URL keeps the open yard and view so Back and shared links return to them", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1280, height: 900 },
  });
  try {
    page.setDefaultTimeout(5_000);
    await serveFixture(page, Promise.resolve());
    await page.goto("http://yard-map.test/?at=40%2C-97%2C8&yard=pyp%3A10");

    // Restored as saved: the yard's card is open and the view is not moved.
    await page.getByRole("button", { name: "Close yard details" }).waitFor();
    await page
      .getByRole("button", {
        name: "Yard 10, Town, TX",
        exact: true,
        pressed: true,
      })
      .waitFor();
    await page.waitForTimeout(400);
    expect(new URL(page.url()).search).toBe("?at=40%2C-97%2C8&yard=pyp%3A10");

    // Closing the card keeps the view and drops only the yard.
    await page.getByRole("button", { name: "Close yard details" }).click();
    await page.waitForFunction(() => location.search === "?at=40%2C-97%2C8");

    // Picking a pin centers it at the same zoom and records both.
    await page
      .getByRole("button", { name: "Yard 11, Town, TX", exact: true })
      .click();
    await page.waitForFunction(
      () => location.search === "?at=39.5%2C-97%2C8&yard=pyp%3A11",
    );
  } finally {
    await closePage(page);
  }
}, 20_000);

test("a link click writes the pending map URL at once and stops later writes, so the navigation is not cancelled", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1280, height: 900 },
  });
  try {
    page.setDefaultTimeout(5_000);
    await serveFixture(page, Promise.resolve());
    // Next.js cancels a pending navigation on any replaceState; count them.
    await page.addInitScript(() => {
      const writes: string[] = [];
      Object.assign(window, { mapUrlWrites: writes });
      const replace = history.replaceState.bind(history);
      history.replaceState = (...args) => {
        replace(...args);
        writes.push(location.search);
      };
    });
    await page.goto("http://yard-map.test/?at=40%2C-97%2C8");
    await page.locator(".yard-map-pin").first().waitFor();
    // A client-side link, like Next.js's, that keeps the page loaded.
    await page.evaluate(() => {
      const link = document.createElement("a");
      link.href = "/junkyards/texas/yard";
      link.textContent = "Inventory";
      link.addEventListener("click", (event) => event.preventDefault());
      document.body.append(link);
    });
    const writes = () =>
      page.evaluate(
        () => (window as unknown as { mapUrlWrites: string[] }).mapUrlWrites,
      );

    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.locator('[aria-busy="false"]').waitFor();
    // Within the 250ms the map waits before writing its new view.
    await page.getByRole("link", { name: "Inventory", exact: true }).click();
    expect(new URL(page.url()).search).toBe("?at=40%2C-97%2C9");
    const atClick = (await writes()).length;

    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(600);
    expect((await writes()).length).toBe(atClick);
    expect(new URL(page.url()).search).toBe("?at=40%2C-97%2C9");
  } finally {
    await closePage(page);
  }
}, 20_000);

/** Each marker's center on screen, with its yard's name. */
function markerCenters(page: Page) {
  return page.locator(".yard-map-pin").evaluateAll((pins) =>
    pins.map((pin) => {
      const box = pin.getBoundingClientRect();
      return {
        name: (pin.getAttribute("aria-label") ?? "").split(",")[0] ?? "",
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
      };
    }),
  );
}

/**
 * How wide the marker canvas draws through each point, in CSS pixels, once
 * it has replaced the server's static dots: 8 for a dot, 12 for a pin, plus
 * a pixel of antialiasing.
 */
async function drawnWidths(page: Page, points: { x: number; y: number }[]) {
  await page.locator(".yard-map-dots").waitFor({ state: "detached" });
  return page.evaluate((points) => {
    const canvas =
      document.querySelector<HTMLCanvasElement>(".yard-map-markers");
    const context = canvas?.getContext("2d");
    if (!canvas || !context) throw new Error("The marker canvas is missing.");
    const box = canvas.getBoundingClientRect();
    const ratio = canvas.width / box.width;
    return points.map(({ x, y }) => {
      const row = Math.round((y - box.top) * ratio);
      const { data } = context.getImageData(0, row, canvas.width, 1);
      const drawn = (column: number) => (data[column * 4 + 3] ?? 0) > 0;
      const column = Math.round((x - box.left) * ratio);
      if (!drawn(column)) return 0;
      let left = column;
      let right = column;
      while (left > 0 && drawn(left - 1)) left--;
      while (right < canvas.width - 1 && drawn(right + 1)) right++;
      return (right - left + 1) / ratio;
    });
  }, points);
}

test("every yard is drawn, and a tap on stacked dots lists the yards under it", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1280, height: 900 },
  });
  try {
    page.setDefaultTimeout(5_000);
    await serveFixture(page, Promise.resolve());
    await page.goto("http://yard-map.test/");
    await page.locator(".yard-map-pin").first().waitFor();
    // The fixture's 40 yards sit half a degree apart on one meridian.
    const markers = await markerCenters(page);
    expect(markers).toHaveLength(40);
    for (const width of await drawnWidths(page, markers)) {
      expect(width).toBeGreaterThanOrEqual(8);
      expect(width).toBeLessThan(10);
    }

    const target = markers.find((marker) => marker.name === "Yard 20");
    if (!target) throw new Error("Yard 20 has no marker.");
    await page.mouse.click(target.x, target.y);
    const list = page.getByRole("list", { name: /yards here$/ });
    await list.waitFor();
    // Every yard whose pin-sized box covers the tap, the tapped one first.
    const expected = markers
      .filter(
        (marker) =>
          Math.abs(marker.x - target.x) < 16 &&
          Math.abs(marker.y - target.y) < 16,
      )
      .map((marker) => marker.name);
    expect(expected.length).toBeGreaterThan(1);
    const options = await list.getByRole("button").allTextContents();
    expect(options.map((option) => option.split("Town")[0])).toEqual(
      expect.arrayContaining(expected),
    );
    expect(options).toHaveLength(expected.length);
    expect(options[0]?.startsWith("Yard 20")).toBe(true);
    const pick = options[1]?.split("Town")[0] ?? "";
    await list.getByRole("button").nth(1).click();
    await page.getByRole("button", { name: "Close yard details" }).waitFor();
    await page
      .getByRole("button", {
        name: `${pick}, Town, TX`,
        exact: true,
        pressed: true,
      })
      .waitFor();
    await expect(list.count()).resolves.toBe(0);
    await page.waitForFunction(
      (code) => new URLSearchParams(location.search).get("yard") === code,
      `pyp:${pick.replace("Yard ", "")}`,
    );
  } finally {
    await closePage(page);
  }
}, 20_000);

test("a tap on a pin standing clear opens its card directly", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1280, height: 900 },
  });
  try {
    page.setDefaultTimeout(5_000);
    await serveFixture(page, Promise.resolve());
    await page.goto("http://yard-map.test/?at=40%2C-97%2C8");
    const pin = page.getByRole("button", {
      name: "Yard 10, Town, TX",
      exact: true,
    });
    await pin.waitFor();
    const box = await pin.boundingBox();
    if (!box) throw new Error("Yard 10's pin has no box.");
    const [width] = await drawnWidths(page, [
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    ]);
    expect(width).toBeGreaterThanOrEqual(12);
    expect(width).toBeLessThan(14);
    await pin.click();
    await page.getByRole("button", { name: "Close yard details" }).waitFor();
    expect(await page.getByRole("list", { name: /yards here$/ }).count()).toBe(
      0,
    );
  } finally {
    await closePage(page);
  }
}, 20_000);

test("Enter on a stacked dot opens that yard, with every yard one arrow key away", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1280, height: 900 },
  });
  try {
    page.setDefaultTimeout(5_000);
    await serveFixture(page, Promise.resolve());
    await page.goto("http://yard-map.test/");
    const stops = page.locator('.yard-map-pin[tabindex="0"]');
    await stops.first().waitFor();
    expect(await stops.count()).toBe(1);
    await stops.first().focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    );
    expect(focused).toBe("Yard 2, Town, TX");
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", {
        name: "Yard 2, Town, TX",
        exact: true,
        pressed: true,
      })
      .waitFor();
    expect(await page.getByRole("list", { name: /yards here$/ }).count()).toBe(
      0,
    );
  } finally {
    await closePage(page);
  }
}, 20_000);

test("a keyboard zoom keeps focus on the pin, whose hit boxes skip paint only while zooming", async () => {
  const page = await createPage(browser, {
    viewport: { width: 1280, height: 900 },
  });
  try {
    page.setDefaultTimeout(5_000);
    await serveFixture(page, Promise.resolve());
    await page.goto("http://yard-map.test/");
    const stops = page.locator('.yard-map-pin[tabindex="0"]');
    await stops.first().waitFor();
    await stops.first().focus();
    await page.keyboard.press("ArrowDown");
    // Each change of the layer while the zoom runs: whether it is zooming,
    // whether its pins skip paint, and the focus.
    await page.evaluate(() => {
      const samples: string[] = [];
      Object.assign(window, { samples });
      const layer = document.querySelector(".yard-map-pin-layer");
      if (!layer) throw new Error("The pin layer is missing.");
      new MutationObserver(() =>
        samples.push(
          `${layer.hasAttribute("data-zooming")} ${getComputedStyle(layer).contentVisibility} ${document.activeElement?.getAttribute("aria-label")}`,
        ),
      ).observe(layer, { attributes: true, attributeFilter: ["data-zooming"] });
    });
    const samples = () =>
      page.evaluate(() =>
        "samples" in window && Array.isArray(window.samples)
          ? window.samples.map(String)
          : [],
      );
    await page.keyboard.press("+");
    await page.waitForFunction(() => {
      const layer = document.querySelector(".yard-map-pin-layer");
      return (
        "samples" in window &&
        Array.isArray(window.samples) &&
        window.samples.length >= 2 &&
        !layer?.hasAttribute("data-zooming")
      );
    });
    expect(await samples()).toEqual([
      "true visible Yard 1, Town, TX",
      "false visible Yard 1, Town, TX",
    ]);

    // Without keyboard focus on a pin, they skip paint until it ends.
    await page.mouse.click(5, 5);
    await page.evaluate(() => {
      if ("samples" in window && Array.isArray(window.samples))
        window.samples.length = 0;
    });
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForFunction(() => {
      const layer = document.querySelector(".yard-map-pin-layer");
      return (
        "samples" in window &&
        Array.isArray(window.samples) &&
        window.samples.length >= 2 &&
        !layer?.hasAttribute("data-zooming")
      );
    });
    expect(
      (await samples()).map((sample) =>
        sample.split(" ").slice(0, 2).join(" "),
      ),
    ).toEqual(["true hidden", "false visible"]);
  } finally {
    await closePage(page);
  }
}, 20_000);

test("a tap on a crowd too long to list zooms in until its yards separate", async () => {
  // On a phone the fixture's 40 yards stack into one tall column of dots.
  const page = await createPage(browser, {
    viewport: { width: 390, height: 844 },
  });
  try {
    page.setDefaultTimeout(5_000);
    await serveFixture(page, Promise.resolve());
    await page.goto("http://yard-map.test/");
    await page.locator(".yard-map-pin").first().waitFor();
    await page.locator(".yard-map").scrollIntoViewIfNeeded();
    const markers = await markerCenters(page);
    const under = (target: { x: number; y: number }) =>
      markers.filter(
        (marker) =>
          Math.abs(marker.x - target.x) < 16 &&
          Math.abs(marker.y - target.y) < 16,
      );
    const crowd = markers.reduce((best, marker) =>
      under(marker).length > under(best).length ? marker : best,
    );
    const tapped = under(crowd).map((marker) => marker.name);
    expect(tapped.length).toBeGreaterThan(6);

    await page.mouse.click(crowd.x, crowd.y);
    await page.waitForFunction(() => {
      const at = new URLSearchParams(location.search).get("at");
      return at !== null;
    });
    expect(await page.getByRole("list", { name: /yards here$/ }).count()).toBe(
      0,
    );
    // The tapped yards now stand apart: no two share a pin-sized box.
    await page.locator('[aria-busy="false"]').waitFor();
    const after = (await markerCenters(page)).filter((marker) =>
      tapped.includes(marker.name),
    );
    const apart = after.every((a, index) =>
      after
        .slice(index + 1)
        .every((b) => Math.abs(a.x - b.x) >= 16 || Math.abs(a.y - b.y) >= 16),
    );
    expect(apart).toBe(true);
  } finally {
    await closePage(page);
  }
}, 20_000);

test("on a phone, a card that opens below the fold scrolls into view and is announced", async () => {
  const page = await createPage(browser, {
    viewport: { width: 390, height: 844 },
  });
  try {
    page.setDefaultTimeout(5_000);
    await serveFixture(page, Promise.resolve());
    await page.goto("http://yard-map.test/?at=40%2C-97%2C8");
    const pin = page.getByRole("button", {
      name: "Yard 10, Town, TX",
      exact: true,
    });
    await pin.waitFor();
    // Page above and below the map, as on /map, scrolled so the map's
    // bottom edge meets the bottom of the screen: the card that opens under
    // the map starts out of view.
    await page.evaluate(() => {
      document.body.style.padding = "600px 0 1500px";
      const map = document.querySelector(".yard-map");
      if (!map) throw new Error("The map did not render.");
      window.scrollBy(0, map.getBoundingClientRect().bottom - innerHeight);
    });
    const before = await page.evaluate(() => scrollY);
    expect(before).toBeGreaterThan(0);
    await pin.click();
    await page.waitForFunction(() => {
      const card = document
        .querySelector('[aria-label="Close yard details"]')
        ?.parentElement?.getBoundingClientRect();
      return (
        card !== undefined && card.top >= 0 && card.bottom <= innerHeight + 1
      );
    });
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before);
    expect(
      await page.locator('[aria-live="polite"]').first().textContent(),
    ).toBe("Yard 10, Town, TX: details shown.");
  } finally {
    await closePage(page);
  }
}, 20_000);
