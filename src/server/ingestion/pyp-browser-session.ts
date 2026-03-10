import { Hyperbrowser } from "@hyperbrowser/sdk";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import { Effect, Scope } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import type { Location } from "~/lib/types";
import type { PypVehicleJson } from "./pyp-transform";
import { BrowserSessionError } from "./errors";

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
 * Hyperbrowser caps sessions at 15 min. Rotate at 12 min to leave headroom.
 */
const SESSION_ROTATE_MS = 12 * 60 * 1000;

export interface PypSession {
  readonly locations: Location[];
  readonly shouldRotate: boolean;
  fetchFilterPage(
    storeCodes: string,
    pageNumber: number,
    pageSize: number,
  ): Effect.Effect<PypFilterResponse, BrowserSessionError>;
  reopen(): Effect.Effect<void, BrowserSessionError>;
}

/**
 * Acquire a managed PYP browser session.
 * The session is automatically closed when the surrounding Scope finalizes,
 * even on failure or interruption.
 */
export function acquirePypSession(
  apiKey: string,
): Effect.Effect<PypSession, BrowserSessionError, Scope.Scope> {
  return Effect.acquireRelease(
    openSession(apiKey),
    (session) =>
      Effect.sync(() => {
        session._close();
      }),
  );
}

interface MutableSessionState {
  client: Hyperbrowser;
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  sessionId: string | null;
  csrfToken: string | null;
  locations: Location[];
  sessionStartedAt: number;
  apiKey: string;
}

function openSession(
  apiKey: string,
): Effect.Effect<PypSession & { _close: () => void }, BrowserSessionError> {
  return Effect.tryPromise({
    try: async () => {
      const state: MutableSessionState = {
        client: new Hyperbrowser({ apiKey }),
        browser: null,
        context: null,
        page: null,
        sessionId: null,
        csrfToken: null,
        locations: [],
        sessionStartedAt: 0,
        apiKey,
      };

      await doOpen(state);

      const session: PypSession & { _close: () => void } = {
        get locations() {
          return state.locations;
        },
        get shouldRotate() {
          if (state.sessionStartedAt === 0) return false;
          return Date.now() - state.sessionStartedAt > SESSION_ROTATE_MS;
        },
        fetchFilterPage: (storeCodes, pageNumber, pageSize) =>
          Effect.tryPromise({
            try: () => doFetchFilterPage(state, storeCodes, pageNumber, pageSize),
            catch: (cause) =>
              new BrowserSessionError({ phase: "fetch", cause }),
          }),
        reopen: () =>
          Effect.tryPromise({
            try: async () => {
              const cachedLocations = state.locations;
              await doClose(state);
              await doOpen(state);
              if (cachedLocations.length > 0 && state.locations.length === 0) {
                state.locations = cachedLocations;
              }
            },
            catch: (cause) =>
              new BrowserSessionError({ phase: "rotate", cause }),
          }),
        _close: () => {
          doClose(state).catch(() => {});
        },
      };

      return session;
    },
    catch: (cause) => new BrowserSessionError({ phase: "open", cause }),
  });
}

async function doOpen(state: MutableSessionState): Promise<void> {
  const session = await state.client.sessions.create({
    useStealth: true,
    acceptCookies: true,
  });
  state.sessionId = session.id;
  state.sessionStartedAt = Date.now();

  state.browser = await chromium.connectOverCDP(session.wsEndpoint);
  state.context =
    state.browser.contexts()[0] ?? (await state.browser.newContext());
  state.page =
    state.context.pages()[0] ?? (await state.context.newPage());

  await state.page.goto(
    `${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`,
    { waitUntil: "networkidle", timeout: 60_000 },
  );

  state.csrfToken = await state.page.evaluate(
    () =>
      (
        document.querySelector(
          "[name=__RequestVerificationToken]",
        ) as HTMLInputElement | null
      )?.value ?? null,
  );
  if (!state.csrfToken) {
    throw new Error(
      "Could not extract RequestVerificationToken from PYP page",
    );
  }

  const rawLocations: PypRawLocation[] = await state.page.evaluate(
    // @ts-expect-error -- _locationList is a global injected by pyp.com
    () => (typeof _locationList !== "undefined" ? _locationList : []),
  );
  state.locations = rawLocations.map(mapRawLocation);
}

async function doFetchFilterPage(
  state: MutableSessionState,
  storeCodes: string,
  pageNumber: number,
  pageSize: number,
): Promise<PypFilterResponse> {
  if (!state.page || !state.csrfToken) {
    throw new Error("PypBrowserSession not open — call open() first");
  }

  const path = `${API_ENDPOINTS.PYP_FILTER_INVENTORY}?store=${storeCodes}&filter=&page=${pageNumber}&pageSize=${pageSize}`;
  const token = state.csrfToken;

  const result = await state.page.evaluate(
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

async function doClose(state: MutableSessionState): Promise<void> {
  await state.page?.close().catch(() => {});
  await state.context?.close().catch(() => {});
  await state.browser?.close().catch(() => {});
  state.page = null;
  state.context = null;
  state.browser = null;
  state.sessionStartedAt = 0;

  if (state.sessionId && state.client) {
    console.log(
      `[PYP] Hyperbrowser session: https://app.hyperbrowser.ai/sessions/${state.sessionId}`,
    );
    await state.client.sessions.stop(state.sessionId).catch(() => {});
    state.sessionId = null;
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

