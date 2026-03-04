import Browserbase from "@browserbasehq/sdk";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
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

/**
 * Manages a remote Browserbase session for PYP scraping.
 *
 * Cloudflare binds its JS-challenge clearance to the browser's TLS fingerprint,
 * so plain Node `fetch()` calls are always rejected even with valid cookies.
 * By running a real Chromium instance via Browserbase and routing API calls
 * through `page.evaluate(fetch(...))`, every request inherits the browser's
 * TLS stack and Cloudflare clearance.
 *
 * Browserbase provides stealth mode and CAPTCHA solving out of the box,
 * eliminating the need for local Chromium/Xvfb in the Trigger.dev container.
 *
 * Lifecycle: `open()` -> `fetchFilterPage()` (N times) -> `close()`
 */
export class PypBrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionId: string | null = null;
  private csrfToken: string | null = null;
  private _locations: Location[] = [];

  get locations(): Location[] {
    return this._locations;
  }

  async open(): Promise<void> {
    const apiKey = process.env.BROWSERBASE_API_KEY;
    const projectId = process.env.BROWSERBASE_PROJECT_ID;
    if (!apiKey || !projectId) {
      throw new Error("BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID must be set");
    }

    const bb = new Browserbase({ apiKey });
    const session = await bb.sessions.create({
      projectId,
      browserSettings: { solveCaptchas: true },
      timeout: 900, 
    });
    this.sessionId = session.id;

    this.browser = await chromium.connectOverCDP(session.connectUrl);

    this.context = this.browser.contexts()[0] ?? await this.browser.newContext();
    this.page = this.context.pages()[0] ?? await this.context.newPage();

    await this.page.goto(
      `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
      { waitUntil: "networkidle", timeout: 60_000 },
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
    this.page = null;
    this.context = null;
    this.browser = null;

    if (this.sessionId) {
      console.log(`[PYP] Browserbase session: https://browserbase.com/sessions/${this.sessionId}`);
      this.sessionId = null;
    }
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
