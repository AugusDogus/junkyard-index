import { Hyperbrowser } from "@hyperbrowser/sdk";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import { Effect, Scope, Schema } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import type { Location } from "~/lib/types";
import { BrowserSessionError } from "./errors";

const PypPhotoSchema = Schema.Struct({
  PhotoPath: Schema.String,
  IsPrimary: Schema.Boolean,
  IsInternal: Schema.Boolean,
  InventoryPhoto: Schema.Boolean,
});

const PypVehicleJsonSchema = Schema.Struct({
  YardCode: Schema.String,
  Section: Schema.String,
  Row: Schema.String,
  SpaceNumber: Schema.String,
  Color: Schema.String,
  Year: Schema.String,
  Make: Schema.String,
  Model: Schema.String,
  InYardDate: Schema.String,
  StockNumber: Schema.String,
  Vin: Schema.String,
  Photos: Schema.Array(PypPhotoSchema),
});

const PypFilterResponseSchema = Schema.Struct({
  Success: Schema.Boolean,
  Errors: Schema.Array(Schema.String),
  ResponseData: Schema.Struct({
    Request: Schema.Struct({
      YardCode: Schema.Array(Schema.String),
      Filter: Schema.String,
      PageSize: Schema.Number,
      PageNumber: Schema.Number,
      FilterDeals: Schema.Boolean,
    }),
    Vehicles: Schema.Array(PypVehicleJsonSchema),
  }),
  Messages: Schema.Array(Schema.String),
});

export type PypFilterResponse = Schema.Schema.Type<typeof PypFilterResponseSchema>;

const decodePypFilterResponse = Schema.decodeUnknownSync(PypFilterResponseSchema);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPypUrls(value: unknown): value is PypRawLocation["Urls"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.Store) &&
    isString(value.Interchange) &&
    isString(value.Inventory) &&
    isString(value.Prices) &&
    isString(value.Directions) &&
    isString(value.SellACar) &&
    isString(value.Contact) &&
    (value.CustomerServiceChat === null ||
      isString(value.CustomerServiceChat)) &&
    (value.CarbuyChat === null || isString(value.CarbuyChat)) &&
    isString(value.Deals) &&
    isString(value.Parts)
  );
}

function isPypRawLocation(value: unknown): value is PypRawLocation {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.LocationCode) &&
    isString(value.LocationPageURL) &&
    isString(value.Name) &&
    isString(value.DisplayName) &&
    isString(value.Address) &&
    isString(value.City) &&
    isString(value.State) &&
    isString(value.StateAbbr) &&
    isString(value.Zip) &&
    isString(value.Phone) &&
    isNumber(value.Lat) &&
    isNumber(value.Lng) &&
    isNumber(value.Distance) &&
    isString(value.LegacyCode) &&
    isString(value.Primo) &&
    isPypUrls(value.Urls)
  );
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

interface ManagedPypSession {
  readonly session: PypSession;
  readonly close: Effect.Effect<void, BrowserSessionError>;
}

/**
 * Acquire a managed PYP browser session.
 * The session is automatically closed when the surrounding Scope finalizes,
 * even on failure or interruption.
 */
export function acquirePypSession(
  apiKey: string,
): Effect.Effect<PypSession, BrowserSessionError, Scope.Scope> {
  const managed = Effect.acquireRelease(
    openSession(apiKey),
    (session) => session.close.pipe(Effect.catchAll(() => Effect.void)),
  );
  return managed.pipe(Effect.map((session) => session.session));
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
): Effect.Effect<ManagedPypSession, BrowserSessionError> {
  return Effect.gen(function* () {
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

    yield* doOpen(state).pipe(
      Effect.tapError(() => doClose(state).pipe(Effect.catchAll(() => Effect.void))),
      Effect.mapError((cause) => new BrowserSessionError({ phase: "open", cause })),
    );

    const close = doClose(state).pipe(
      Effect.mapError((cause) => new BrowserSessionError({ phase: "close", cause })),
    );

    const session: PypSession = {
      get locations() {
        return state.locations;
      },
      get shouldRotate() {
        if (state.sessionStartedAt === 0) return false;
        return Date.now() - state.sessionStartedAt > SESSION_ROTATE_MS;
      },
      fetchFilterPage: (storeCodes, pageNumber, pageSize) =>
        doFetchFilterPage(state, storeCodes, pageNumber, pageSize).pipe(
          Effect.mapError((cause) =>
            new BrowserSessionError({ phase: "fetch", cause }),
          ),
        ),
      reopen: () =>
        Effect.gen(function* () {
          const cachedLocations = state.locations;
          yield* close;
          yield* doOpen(state).pipe(
            Effect.tapError(() =>
              doClose(state).pipe(Effect.catchAll(() => Effect.void)),
            ),
            Effect.mapError((cause) =>
              new BrowserSessionError({ phase: "rotate", cause }),
            ),
          );
          if (cachedLocations.length > 0 && state.locations.length === 0) {
            state.locations = cachedLocations;
          }
        }),
    };

    return { session, close };
  });
}

function doOpen(state: MutableSessionState): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const session = yield* Effect.tryPromise(() =>
      state.client.sessions.create({
        useStealth: true,
        acceptCookies: true,
      }),
    );
    state.sessionId = session.id;
    state.sessionStartedAt = Date.now();

    const browser = yield* Effect.tryPromise(() =>
      chromium.connectOverCDP(session.wsEndpoint),
    );
    state.browser = browser;

    const context =
      browser.contexts()[0] ??
      (yield* Effect.tryPromise(() => browser.newContext()));
    state.context = context;

    const page =
      context.pages()[0] ?? (yield* Effect.tryPromise(() => context.newPage()));
    state.page = page;

    yield* Effect.tryPromise(() =>
      page.goto(`${API_ENDPOINTS.PYP_BASE}${API_ENDPOINTS.LOCATION_PAGE}`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      }),
    );

    state.csrfToken = yield* Effect.tryPromise(() =>
      page.evaluate(() => {
        const element = document.querySelector("[name=__RequestVerificationToken]");
        return element instanceof HTMLInputElement ? element.value : null;
      }),
    );
    if (!state.csrfToken) {
      return yield* Effect.fail(
        new Error("Could not extract RequestVerificationToken from PYP page"),
      );
    }

    const rawLocations = yield* Effect.tryPromise(() =>
      page.evaluate(() => {
        const value = Reflect.get(globalThis, "_locationList");
        return Array.isArray(value) ? value : [];
      }),
    );
    state.locations = rawLocations.filter(isPypRawLocation).map(mapRawLocation);
  }).pipe(Effect.asVoid);
}

function doFetchFilterPage(
  state: MutableSessionState,
  storeCodes: string,
  pageNumber: number,
  pageSize: number,
): Effect.Effect<PypFilterResponse, unknown> {
  return Effect.gen(function* () {
    const page = state.page;
    const token = state.csrfToken;
    if (!page || !token) {
      return yield* Effect.fail(
        new Error("PypBrowserSession not open — call open() first"),
      );
    }

    const path = `${API_ENDPOINTS.PYP_FILTER_INVENTORY}?store=${storeCodes}&filter=&page=${pageNumber}&pageSize=${pageSize}`;

    const result = yield* Effect.tryPromise(() =>
      page.evaluate(
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
      ),
    );

    if (result._error) {
      return yield* Effect.fail(
        new Error(`PYP Filter API returned ${result.status}`),
      );
    }

    const decoded = yield* Effect.try({
      try: () => decodePypFilterResponse(result.data),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    return decoded;
  });
}

function doClose(state: MutableSessionState): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const page = state.page;
    if (page) {
      yield* Effect.tryPromise(() => page.close().catch(() => undefined));
    }
    const context = state.context;
    if (context) {
      yield* Effect.tryPromise(() => context.close().catch(() => undefined));
    }
    const browser = state.browser;
    if (browser) {
      yield* Effect.tryPromise(() => browser.close().catch(() => undefined));
    }
    state.page = null;
    state.context = null;
    state.browser = null;
    state.sessionStartedAt = 0;

    const sessionId = state.sessionId;
    if (sessionId) {
      yield* Effect.logInfo(
        `[PYP] Hyperbrowser session: https://app.hyperbrowser.ai/sessions/${sessionId}`,
      );
      yield* Effect.tryPromise(() =>
        state.client.sessions.stop(sessionId).catch(() => undefined),
      );
      state.sessionId = null;
    }
  }).pipe(Effect.asVoid);
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

