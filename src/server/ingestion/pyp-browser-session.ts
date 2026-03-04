import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { API_ENDPOINTS } from "~/lib/constants";
import type { Location } from "~/lib/types";
import type { PypVehicleJson } from "./pyp-transform";

/**
 * PYP /api/Inventory/Filter response shape.
 * Duplicated from pyp-connector so the browser session module is self-contained.
 */
export interface PypFilterResponse {
  Success: boolean;
  Errors: string[];
  ResponseData: {
    Request: {
      YardCode: string[];
      Filter: string;
      PageSize: number;
      PageNumber: number;
      FilterDeals: boolean;
    };
    Vehicles: PypVehicleJson[];
  };
  Messages: string[];
}

/**
 * Raw shape of a location object embedded in pyp.com's `_locationList` global.
 */
interface PypRawLocation {
  LocationCode: string;
  LocationPageURL: string;
  Name: string;
  DisplayName: string;
  Address: string;
  City: string;
  State: string;
  StateAbbr: string;
  Zip: string;
  Phone: string;
  Lat: number;
  Lng: number;
  Distance: number;
  LegacyCode: string;
  Primo: string;
  Urls: {
    Store: string;
    Interchange: string;
    Inventory: string;
    Prices: string;
    Directions: string;
    SellACar: string;
    Contact: string;
    CustomerServiceChat: string | null;
    CarbuyChat: string | null;
    Deals: string;
    Parts: string;
  };
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Manages a headed Playwright browser session against pyp.com.
 *
 * Cloudflare binds its JS-challenge clearance to the browser's TLS fingerprint,
 * so plain Node `fetch()` calls are always rejected even with valid cookies.
 * By keeping an actual Chromium instance open and routing API calls through
 * `page.evaluate(fetch(...))`, every request inherits the browser's TLS stack
 * and Cloudflare clearance.
 *
 * Lifecycle: `open()` -> `fetchFilterPage()` (N times) -> `close()`
 */
export class PypBrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private xvfbProcess: ChildProcess | null = null;
  private csrfToken: string | null = null;
  private _locations: Location[] = [];

  get locations(): Location[] {
    return this._locations;
  }

  private async ensureLinuxDisplay(): Promise<void> {
    if (process.platform !== "linux") {
      return;
    }
    if (process.env.DISPLAY) {
      return;
    }

    try {
      this.xvfbProcess = spawn(
        "Xvfb",
        [":99", "-screen", "0", "1280x720x24", "-nolisten", "tcp"],
        {
          stdio: "ignore",
        },
      );
      process.env.DISPLAY = ":99";
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 250);
      });
    } catch (error) {
      throw new Error(
        `Failed to start Xvfb for headed Chromium: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async open(): Promise<void> {
    await this.ensureLinuxDisplay();

    this.browser = await chromium.launch({
      headless: false,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

    this.context = await this.browser.newContext({ userAgent: USER_AGENT });
    this.page = await this.context.newPage();

    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    await this.page.goto(
      `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
      { waitUntil: "networkidle", timeout: 45_000 },
    );

    this.csrfToken = await this.page.evaluate(
      () =>
        (
          document.querySelector(
            '[name=__RequestVerificationToken]',
          ) as HTMLInputElement | null
        )?.value ?? null,
    );
    if (!this.csrfToken) {
      throw new Error("Could not extract RequestVerificationToken from PYP page");
    }

    const rawLocations: PypRawLocation[] = await this.page.evaluate(
      // @ts-expect-error -- _locationList is a global injected by pyp.com
      () => (typeof _locationList !== "undefined" ? _locationList : []),
    );
    this._locations = rawLocations.map(mapRawLocation);
  }

  /**
   * Call the PYP Filter API from within the browser page context.
   * The request inherits the browser's Cloudflare clearance and TLS fingerprint.
   */
  async fetchFilterPage(
    storeCodes: string,
    pageNumber: number,
    pageSize: number,
  ): Promise<PypFilterResponse> {
    if (!this.page || !this.csrfToken) {
      throw new Error("PypBrowserSession not open — call open() first");
    }

    const path = `${API_ENDPOINTS.PYP_FILTER_INVENTORY}?store=${storeCodes}&filter=&page=${pageNumber}&pageSize=${pageSize}`;
    const token = this.csrfToken;

    const result = await this.page.evaluate(
      async ({ path, token }: { path: string; token: string }) => {
        const res = await fetch(path, {
          headers: {
            Accept: "application/json",
            RequestVerificationToken: token,
            "X-Requested-With": "XMLHttpRequest",
          },
        });
        if (!res.ok) {
          return { _error: true as const, status: res.status };
        }
        return { _error: false as const, data: await res.json() };
      },
      { path, token },
    );

    if (result._error) {
      throw new Error(`PYP Filter API returned ${result.status}`);
    }

    return result.data as PypFilterResponse;
  }


  async close(): Promise<void> {
    await this.page?.close().catch(() => {});
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    if (this.xvfbProcess && !this.xvfbProcess.killed) {
      this.xvfbProcess.kill("SIGTERM");
    }
    this.xvfbProcess = null;
    this.page = null;
    this.context = null;
    this.browser = null;
  }
}

function mapRawLocation(raw: PypRawLocation): Location {
  return {
    locationCode: raw.LocationCode,
    locationPageURL: raw.LocationPageURL,
    name: raw.Name,
    displayName: raw.DisplayName,
    address: raw.Address,
    city: raw.City,
    state: raw.State,
    stateAbbr: raw.StateAbbr,
    zip: raw.Zip,
    phone: raw.Phone,
    lat: raw.Lat,
    lng: raw.Lng,
    distance: raw.Distance,
    legacyCode: raw.LegacyCode,
    primo: raw.Primo,
    source: "pyp",
    urls: {
      store: raw.Urls.Store,
      interchange: raw.Urls.Interchange,
      inventory: raw.Urls.Inventory,
      prices: raw.Urls.Prices,
      directions: raw.Urls.Directions,
      sellACar: raw.Urls.SellACar,
      contact: raw.Urls.Contact,
      customerServiceChat: raw.Urls.CustomerServiceChat,
      carbuyChat: raw.Urls.CarbuyChat,
      deals: raw.Urls.Deals,
      parts: raw.Urls.Parts,
    },
  };
}
