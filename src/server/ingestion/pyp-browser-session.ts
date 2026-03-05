import { Hyperbrowser } from "@hyperbrowser/sdk";
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
 * Hyperbrowser caps sessions at 15 min. We rotate at 12 min to leave headroom
 * for session setup (~5-10s) and any in-flight request that might be slow.
 */
const SESSION_ROTATE_MS = 12 * 60 * 1000;

/**
 * Manages a remote Hyperbrowser session for PYP scraping.
 *
 * ## Why a managed cloud browser?
 *
 * PYP's Cloudflare protection detects headless browsers and rejects requests
 * based on unknown signals (likely TLS fingerprinting, JA3 hashes, or browser
 * attestation). Even headed Playwright in Trigger.dev's container (via Xvfb)
 * was unreliable across deploys. A managed cloud browser with stealth mode
 * handles this reliably.
 *
 * ## Why page.evaluate(fetch(...)) instead of extracting cookies?
 *
 * Extracting cookies from the browser and replaying them with Node `fetch()`
 * still gets blocked by Cloudflare — likely because the detection goes beyond
 * cookies (TLS fingerprint, JA3 hash, browser attestation, etc.). The only
 * reliable approach we've found is executing fetch() from within the browser's
 * page context so every request inherits the browser's full network stack.
 *
 * ## Session rotation
 *
 * Hyperbrowser has a 15-minute max session duration. The full crawl at ~4s/page
 * takes ~11 minutes, so it usually fits in one session, but server response
 * times are unpredictable. `reopen()` closes the current session and opens a
 * fresh one, preserving the cached location list so pagination resumes
 * seamlessly.
 *
 * Lifecycle: `open()` -> `fetchFilterPage()` (N times) -> optionally `reopen()` -> ... -> `close()`
 */
export class PypBrowserSession {
  private client: Hyperbrowser | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private sessionId: string | null = null;
  private csrfToken: string | null = null;
  private _locations: Location[] = [];
  private sessionStartedAt = 0;

  get locations(): Location[] {
    return this._locations;
  }

  get shouldRotate(): boolean {
    if (this.sessionStartedAt === 0) return false;
    return Date.now() - this.sessionStartedAt > SESSION_ROTATE_MS;
  }

  async open(): Promise<void> {
    const apiKey = process.env.HYPERBROWSER_API_KEY;
    if (!apiKey) {
      throw new Error("HYPERBROWSER_API_KEY must be set");
    }

    this.client = new Hyperbrowser({ apiKey });
    const session = await this.client.sessions.create({
      useStealth: true,
      acceptCookies: true,
    });
    this.sessionId = session.id;
    this.sessionStartedAt = Date.now();

    this.browser = await chromium.connectOverCDP(session.wsEndpoint);

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
   * Close the current session and open a fresh one.
   * Preserves the cached location list so the caller can continue pagination
   * without re-extracting locations.
   */
  async reopen(): Promise<void> {
    const cachedLocations = this._locations;
    await this.close();
    await this.open();
    if (cachedLocations.length > 0 && this._locations.length === 0) {
      this._locations = cachedLocations;
    }
  }

  /**
   * Call the PYP Filter API from within the browser page context.
   * The request inherits the browser's Cloudflare clearance and network stack.
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
    this.sessionStartedAt = 0;

    if (this.sessionId && this.client) {
      console.log(`[PYP] Hyperbrowser session: https://app.hyperbrowser.ai/sessions/${this.sessionId}`);
      await this.client.sessions.stop(this.sessionId).catch(() => {});
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
