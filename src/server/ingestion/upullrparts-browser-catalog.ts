import { chromium, type Browser, type Page } from "playwright-core";
import { Effect, Schema } from "effect";
import {
  UPULLRPARTS_API_URL,
  UPULLRPARTS_INVENTORY_URL,
  UpullRPartsProviderError,
} from "./upullrparts-client";

// getVehicles needs a single-use Cloudflare Turnstile token and a location,
// and returns at most 100 vehicles, newest DateSetData first. Minnesota (1)
// covers stores 1 and 2; Toledo (3) covers store 3.
export const UPULLRPARTS_CATALOG_LOCATIONS = ["1", "3"] as const;
export type UpullRPartsCatalogLocation =
  (typeof UPULLRPARTS_CATALOG_LOCATIONS)[number];
export const UPULLRPARTS_CATALOG_PAGE_LIMIT = 100;
const UPULLRPARTS_CATALOG_START_DATE = "2016-01-01";
const MAX_REQUESTS_PER_LOCATION = 200;
// After two tokens on one page load, Turnstile escalates to an interactive
// challenge that takes about two minutes. A fresh page load avoids that.
const TOKENS_PER_PAGE_LOAD = 2;
const TOKEN_TIMEOUT_MS = 180_000;
const CDP_CONNECT_TIMEOUT_MS = 45_000;
const BROWSERBASE_API_URL = "https://api.browserbase.com/v1/sessions";

export interface BrowserbaseConfig {
  apiKey: string;
  projectId: string;
}

export type UpullRPartsCatalogStep =
  | { status: "complete" }
  | { status: "continue"; endDate: string }
  | { status: "invalid"; message: string };

const DatedRow = Schema.Struct({
  DateSetData: Schema.String.pipe(Schema.pattern(/^\d{4}-\d{2}-\d{2}$/)),
});

/**
 * A full page holds the newest vehicles through its oldest set date, and that
 * oldest day may be cut off, so the next page ends on that day again.
 */
export function nextUpullRPartsCatalogStep(
  rows: readonly unknown[],
  endDate: string,
): UpullRPartsCatalogStep {
  if (rows.length < UPULLRPARTS_CATALOG_PAGE_LIMIT)
    return { status: "complete" };
  let oldest: string | null = null;
  for (const row of rows) {
    const decoded = Schema.decodeUnknownOption(DatedRow)(row);
    if (decoded._tag === "None")
      return {
        status: "invalid",
        message: `a full page through ${endDate} has a vehicle without a yyyy-mm-dd DateSetData, so older vehicles cannot be paged`,
      };
    const date = decoded.value.DateSetData;
    if (oldest === null || date < oldest) oldest = date;
  }
  if (oldest === null || oldest >= endDate)
    return {
      status: "invalid",
      message: `${endDate} alone has at least ${UPULLRPARTS_CATALOG_PAGE_LIMIT} vehicles, so date paging cannot reach the rest of that day`,
    };
  return { status: "continue", endDate: oldest };
}

const BrowserbaseSession = Schema.Struct({
  id: Schema.String,
  connectUrl: Schema.String,
});

interface CatalogBrowser {
  readonly sessionId: string;
  readonly browser: Browser;
  readonly page: Page;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function openBrowser(config: BrowserbaseConfig) {
  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(BROWSERBASE_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-BB-API-Key": config.apiKey,
          },
          body: JSON.stringify({
            projectId: config.projectId,
            browserSettings: { solveCaptchas: true },
          }),
        }),
      catch: toError,
    });
    if (!response.ok) {
      const body = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: toError,
      });
      return yield* Effect.fail(
        new Error(
          `Browserbase session create returned HTTP ${response.status}: ${body.slice(0, 200)}`,
        ),
      );
    }
    const session = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: toError,
    }).pipe(Effect.flatMap(Schema.decodeUnknown(BrowserbaseSession)));
    const browser = yield* Effect.tryPromise({
      try: () =>
        chromium.connectOverCDP(session.connectUrl, {
          timeout: CDP_CONNECT_TIMEOUT_MS,
        }),
      catch: toError,
    }).pipe(Effect.tapError(() => releaseSession(config, session.id)));
    const page =
      browser.contexts()[0]?.pages()[0] ??
      (yield* Effect.tryPromise({
        try: () => browser.newPage(),
        catch: toError,
      }).pipe(
        Effect.tapError(() =>
          Effect.promise(() => browser.close().catch(() => undefined)).pipe(
            Effect.zipRight(releaseSession(config, session.id)),
          ),
        ),
      ));
    return { sessionId: session.id, browser, page } satisfies CatalogBrowser;
  });
}

function releaseSession(config: BrowserbaseConfig, sessionId: string) {
  return Effect.promise(() =>
    fetch(`${BROWSERBASE_API_URL}/${sessionId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BB-API-Key": config.apiKey,
      },
      body: JSON.stringify({
        projectId: config.projectId,
        status: "REQUEST_RELEASE",
      }),
    }).catch(() => undefined),
  ).pipe(Effect.asVoid);
}

function closeBrowser(config: BrowserbaseConfig, catalog: CatalogBrowser) {
  return Effect.promise(() =>
    catalog.browser.close().catch(() => undefined),
  ).pipe(Effect.zipRight(releaseSession(config, catalog.sessionId)));
}

function loadInventoryPage(page: Page) {
  return Effect.tryPromise({
    try: async () => {
      await page.goto(UPULLRPARTS_INVENTORY_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      // The page renders its Turnstile widget beside the vehicle search form.
      await page.getByText("Search By Vehicle").click();
    },
    catch: toError,
  });
}

function fetchVehiclePage(
  page: Page,
  location: UpullRPartsCatalogLocation,
  endDate: string,
) {
  return Effect.tryPromise({
    try: async () => {
      await page.waitForFunction(
        () => Reflect.get(window, "upullTurnstileReady") === true,
        null,
        { timeout: TOKEN_TIMEOUT_MS, polling: 250 },
      );
      return page.evaluate(
        async ({ apiUrl, site, beginDate, endDate }) => {
          const getToken = Reflect.get(window, "getTurnstileToken");
          const refresh = Reflect.get(window, "refreshTurnstile");
          if (typeof getToken !== "function" || typeof refresh !== "function")
            return {
              ok: false as const,
              error:
                "the inventory page no longer exposes its Turnstile helpers",
            };
          const token: unknown = getToken();
          refresh();
          if (typeof token !== "string" || token === "")
            return { ok: false as const, error: "Turnstile returned no token" };
          const response = await fetch(apiUrl, {
            method: "POST",
            body: new URLSearchParams({
              action: "doAaaApiCall",
              apiAction: "getVehicles",
              site,
              makes: "",
              models: "0",
              years: "0",
              beginDate,
              endDate,
              turnstileToken: token,
            }),
          });
          const text = await response.text();
          return response.ok
            ? { ok: true as const, text }
            : {
                ok: false as const,
                error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
              };
        },
        {
          apiUrl: UPULLRPARTS_API_URL,
          site: location,
          beginDate: UPULLRPARTS_CATALOG_START_DATE,
          endDate,
        },
      );
    },
    catch: toError,
  }).pipe(
    Effect.flatMap((result) =>
      result.ok
        ? Effect.try({
            try: (): unknown => JSON.parse(result.text),
            catch: toError,
          })
        : Effect.fail(new Error(result.error)),
    ),
    Effect.flatMap((body) =>
      Array.isArray(body)
        ? Effect.succeed<readonly unknown[]>(body)
        : Effect.fail(new Error("getVehicles did not return an array")),
    ),
    Effect.mapError(
      (cause) =>
        new Error(
          `U Pull R Parts getVehicles location ${location} through ${endDate}: ${cause.message}`,
        ),
    ),
  );
}

function crawlLocation(
  config: BrowserbaseConfig,
  location: UpullRPartsCatalogLocation,
  today: string,
) {
  return Effect.gen(function* () {
    const { page } = yield* Effect.acquireRelease(
      openBrowser(config),
      (catalog) => closeBrowser(config, catalog),
    );
    // Overlapping pages repeat the oldest day's rows verbatim.
    const records = new Map<string, unknown>();
    let endDate = today;
    for (let request = 0; request < MAX_REQUESTS_PER_LOCATION; request++) {
      if (request % TOKENS_PER_PAGE_LOAD === 0) yield* loadInventoryPage(page);
      const rows = yield* fetchVehiclePage(page, location, endDate);
      for (const row of rows) records.set(JSON.stringify(row), row);
      const step = nextUpullRPartsCatalogStep(rows, endDate);
      if (step.status === "complete") return [...records.values()];
      if (step.status === "invalid")
        return yield* Effect.fail(
          new Error(`U Pull R Parts location ${location}: ${step.message}`),
        );
      endDate = step.endDate;
    }
    return yield* Effect.fail(
      new Error(
        `U Pull R Parts location ${location} still had full pages after ${MAX_REQUESTS_PER_LOCATION} requests. Inspect getVehicles ordering before retrying.`,
      ),
    );
  }).pipe(Effect.scoped);
}

/** Every distinct vehicle row from both locations. */
export function fetchUpullRPartsBrowserCatalog(
  config: BrowserbaseConfig,
  now = new Date(),
): Effect.Effect<readonly unknown[], UpullRPartsProviderError> {
  const today = now.toISOString().slice(0, 10);
  return Effect.forEach(
    UPULLRPARTS_CATALOG_LOCATIONS,
    (location) => crawlLocation(config, location, today),
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map((locations) => locations.flat()),
    Effect.mapError((cause) => new UpullRPartsProviderError({ cause })),
  );
}
