import { chromium, type Page } from "playwright-core";
import { Effect, Scope } from "effect";
import { Config, Database } from "../src/server/ingestion/context";
import {
  DocumentTransport,
  type BrowserSessions,
} from "../src/server/ingestion/document-transport";
import { BrowserSessionError } from "../src/server/ingestion/errors";
import { KernelUsage } from "../src/server/ingestion/kernel-usage";
import type { ProviderRequestGate } from "../src/server/ingestion/provider-http-client";
import {
  UPULLRPARTS_INVENTORY_URL,
  UpullRPartsProviderError,
} from "../src/server/ingestion/upullrparts-client";
import {
  checkUpullRPartsKernelSpend,
  decodeUpullRPartsVinMakes,
  makeUpullRPartsRequestGate,
  makeUpullRPartsSearchGate,
  streamUpullRPartsInventoryWithSearch,
  type UpullRPartsStreamOptions,
} from "../src/server/ingestion/upullrparts-connector";
import type { UpullRPartsSearch } from "../src/server/ingestion/upullrparts-date-crawl";
import type { UpullRPartsHistory } from "../src/server/ingestion/upullrparts-history";

/*
 * Soak only: when the soak machine's own IP is blocked by getVehicles, its
 * searches can be sent from inside the Kernel browser that mints their
 * tokens, so they leave from that browser's stealth-proxy IP instead. Every
 * part of the crawl runs as in production except where searches leave from,
 * and the browser stays open for the whole chunk, so it bills the chunk's
 * length rather than only its minting.
 */

async function loadInventory(page: Page) {
  await page.goto(UPULLRPARTS_INVENTORY_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  if (page.url().includes("/.well-known/"))
    throw new Error(
      `robot challenge instead of the inventory page: ${page.url()}`,
    );
  await page.getByText("Search By Vehicle").first().click({ timeout: 60_000 });
}

async function mint(page: Page): Promise<string> {
  for (let load = 0; load < 2; load++) {
    if (load > 0) await loadInventory(page);
    for (let click = 0; click <= 6; click++) {
      const ready = await page
        .waitForFunction(
          () => Reflect.get(window, "upullTurnstileReady") === true,
          undefined,
          { timeout: click === 0 ? 800 : 5_000, polling: 200 },
        )
        .then(
          () => true,
          () => false,
        );
      if (ready) {
        const token = await page.evaluate(() => {
          const get: unknown = Reflect.get(window, "getTurnstileToken");
          const refresh: unknown = Reflect.get(window, "refreshTurnstile");
          if (typeof get !== "function" || typeof refresh !== "function")
            return "";
          const value: unknown = Reflect.apply(get, window, []);
          if (typeof value !== "string" || value === "") return "";
          Reflect.apply(refresh, window, []);
          return value;
        });
        if (token) return token;
      }
      const widget = page.locator("#upull-turnstile");
      await widget.scrollIntoViewIfNeeded().catch(() => undefined);
      const box = await widget.boundingBox().catch(() => null);
      if (box) await page.mouse.click(box.x + 28, box.y + box.height / 2);
    }
  }
  throw new Error("Turnstile issued no token after 2 loads");
}

function openPage(sessions: BrowserSessions) {
  return Effect.gen(function* () {
    const session = yield* DocumentTransport.acquireSession(sessions);
    const browser = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          chromium.connectOverCDP(session.wsEndpoint, { timeout: 45_000 }),
        catch: (cause) => new BrowserSessionError({ phase: "open", cause }),
      }),
      (b) => Effect.promise(() => b.close().catch(() => undefined)),
    );
    return yield* Effect.tryPromise({
      try: async () => {
        const context = browser.contexts()[0] ?? (await browser.newContext());
        const page = context.pages()[0] ?? (await context.newPage());
        await page.route("**/*", (route) =>
          ["image", "media", "font"].includes(route.request().resourceType())
            ? route.abort()
            : route.continue(),
        );
        await loadInventory(page);
        return page;
      },
      catch: (cause) => new BrowserSessionError({ phase: "open", cause }),
    });
  });
}

/** A search that mints its token and sends it from the same browser page,
 * opened on the first search and closed with the enclosing scope. */
function browserEgressSearch(
  sessions: BrowserSessions,
  pace: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const page = yield* Effect.cached(
      openPage(sessions).pipe(Scope.extend(scope)),
    );
    const search: UpullRPartsSearch<
      UpullRPartsProviderError | Effect.Effect.Error<typeof page>
    > = (params) =>
      Effect.gen(function* () {
        const tab = yield* page;
        const token = yield* Effect.tryPromise({
          try: () => mint(tab),
          catch: (cause) => new UpullRPartsProviderError({ cause }),
        });
        const response = yield* pace(
          Effect.tryPromise({
            try: () =>
              tab.evaluate(
                async ({ params, token }) => {
                  const sent = await fetch("/wp-admin/admin-ajax.php", {
                    method: "POST",
                    body: new URLSearchParams({
                      action: "doAaaApiCall",
                      apiAction: "getVehicles",
                      site: params.site,
                      makes: params.makes,
                      models: "0",
                      years: "0",
                      beginDate: params.beginDate,
                      endDate: params.endDate,
                      turnstileToken: token,
                    }),
                  });
                  return { status: sent.status, text: await sent.text() };
                },
                { params, token },
              ),
            catch: (cause) => new UpullRPartsProviderError({ cause }),
          }),
        );
        const rows: unknown = yield* Effect.try({
          try: () => JSON.parse(response.text),
          catch: (cause) => new UpullRPartsProviderError({ cause }),
        });
        if (response.status !== 200 || !Array.isArray(rows))
          return yield* new UpullRPartsProviderError({
            cause: new Error(
              `getVehicles from the browser returned HTTP ${response.status}: ${response.text.slice(0, 200)}`,
            ),
          });
        const list: readonly unknown[] = rows;
        return list;
      });
    return search;
  });
}

/** `streamUpullRPartsInventory` with searches sent from the token browser. */
export function streamUpullRPartsViaBrowser<E, R>(
  options: UpullRPartsStreamOptions<E, R> & {
    loadHistory: () => Promise<UpullRPartsHistory>;
  },
) {
  return Effect.gen(function* () {
    const database = yield* Database;
    const sessions = KernelUsage.metered(
      DocumentTransport.kernel(
        (yield* Config).kernelApiKey,
        "upullrparts",
        "page",
      ),
      { database, source: "upullrparts" },
    );
    const requestGate = yield* makeUpullRPartsRequestGate;
    return yield* streamUpullRPartsInventoryWithSearch(options, {
      requestGate,
      openSearch: () =>
        Effect.gen(function* () {
          const pace = yield* makeUpullRPartsSearchGate;
          return yield* browserEgressSearch(sessions, pace);
        }),
      checkSpend: checkUpullRPartsKernelSpend(database),
      loadHistory: Effect.promise(options.loadHistory),
      decodeVins: decodeUpullRPartsVinMakes,
    });
  }).pipe(Effect.scoped);
}
