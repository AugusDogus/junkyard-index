import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { chromium } from "playwright-core";

// Node-only PYP repro helper.
// This exists because local Hyperbrowser CDP was flaky under Bun for exact-page replays.
const API_ENDPOINTS = {
  PYP_BASE: "https://www.pyp.com",
  LOCATION_PAGE: "/inventory/",
  PYP_FILTER_INVENTORY: "/DesktopModules/pyp_api/api/Inventory/Filter",
};

const HYPERBROWSER_REGION = "us-west";
const CONNECT_TIMEOUT_MS = 45_000;

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

function requireArg(flag) {
  const value = getArg(flag);
  if (!value) {
    throw new Error(`Missing required argument: ${flag}`);
  }
  return value;
}

function saveOutput(filename, payload) {
  mkdirSync(resolve(process.cwd(), "tmp"), { recursive: true });
  const outputPath = resolve(process.cwd(), "tmp", filename);
  writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return outputPath;
}

async function main() {
  const apiKey = process.env.HYPERBROWSER_API_KEY;
  if (!apiKey) {
    throw new Error("HYPERBROWSER_API_KEY must be set");
  }

  const pageNumber = Number.parseInt(requireArg("--page"), 10);
  const pageSize = Number.parseInt(getArg("--pageSize") ?? "500", 10);
  const client = new Hyperbrowser({ apiKey });

  const session = await client.sessions.create({
    useStealth: true,
    acceptCookies: true,
    region: HYPERBROWSER_REGION,
  });

  let browser;
  try {
    browser = await chromium.connectOverCDP(session.wsEndpoint, {
      timeout: CONNECT_TIMEOUT_MS,
    });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto(`${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });

    const csrfToken = await page.evaluate(() => {
      const element = document.querySelector("[name=__RequestVerificationToken]");
      return element instanceof HTMLInputElement ? element.value : null;
    });
    if (!csrfToken) {
      throw new Error("Could not extract RequestVerificationToken from PYP page");
    }

    const rawLocations = await page.evaluate(() => {
      const value = Reflect.get(globalThis, "_locationList");
      return Array.isArray(value) ? value : [];
    });

    const storeCodes = rawLocations
      .map((location) => location?.LocationCode)
      .filter((value) => typeof value === "string" && value.length > 0)
      .join(",");
    if (!storeCodes) {
      throw new Error("Could not extract any PYP store codes");
    }

    const path = `${API_ENDPOINTS.PYP_FILTER_INVENTORY}?store=${storeCodes}&filter=&page=${pageNumber}&pageSize=${pageSize}`;
    const result = await page.evaluate(
      async ({ path, token }) => {
        const res = await fetch(path, {
          headers: {
            Accept: "application/json",
            RequestVerificationToken: token,
            "X-Requested-With": "XMLHttpRequest",
          },
        });
        if (!res.ok) {
          return { ok: false, status: res.status };
        }
        return { ok: true, data: await res.json() };
      },
      { path, token: csrfToken },
    );

    if (!result.ok) {
      throw new Error(`PYP Filter API returned ${result.status}`);
    }

    const outputPath = saveOutput(`pyp-page-${pageNumber}.json`, result.data);
    const vehicleCount = Array.isArray(result.data?.ResponseData?.Vehicles)
      ? result.data.ResponseData.Vehicles.length
      : null;

    console.log(
      JSON.stringify(
        {
          provider: "pyp",
          page: pageNumber,
          ok: true,
          locations: rawLocations.length,
          vehicles: vehicleCount,
          savedTo: outputPath,
          runtime: process.release.name,
          hyperbrowserRegion: HYPERBROWSER_REGION,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser?.close().catch(() => {});
    await client.sessions.stop(session.id).catch(() => {});
  }
}

await main();
