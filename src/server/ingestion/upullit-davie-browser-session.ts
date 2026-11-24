import { chromium, type Browser, type Page } from "playwright-core";
import { Effect, Schema, Scope } from "effect";
import {
  DocumentTransport,
  type BrowserSessionLifecycle,
} from "./document-transport";
import { BrowserSessionError } from "./errors";
import type {
  ProviderCapacityDeferred,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";
import {
  UPULLIT_DAVIE_ORIGIN,
  type UpullitDaviePage,
  UpullitDaviePageSchema,
} from "./upullit-davie-client";

const CDP_CONNECT_TIMEOUT_MS = 45_000;
const BROWSER_REQUEST_TIMEOUT_MS = 30_000;

export interface UpullitDavieBrowserSession {
  fetchPage(
    pageNumber: number,
  ): Effect.Effect<UpullitDaviePage, BrowserSessionError>;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** One session for the enclosing scope from `sessions` (the provider
 * `BROWSER_PROVIDERS` chooses), opened under its session lease. The browser
 * disconnects and the session stops before the lease is released, also when
 * opening fails. A busy lease or plan defers the chunk. */
export function acquireUpullitDavieSession(
  sessions: BrowserSessionLifecycle,
): Effect.Effect<
  UpullitDavieBrowserSession,
  BrowserSessionError | ProviderTurnDeferred | ProviderCapacityDeferred,
  Scope.Scope
> {
  return Effect.gen(function* () {
    const session = yield* DocumentTransport.acquireSession(sessions);
    const browser = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          chromium.connectOverCDP(session.wsEndpoint, {
            timeout: CDP_CONNECT_TIMEOUT_MS,
          }),
        catch: (cause) => new BrowserSessionError({ phase: "open", cause }),
      }),
      (connected) =>
        Effect.promise(() => connected.close().catch(() => undefined)),
    );
    const page = yield* openInventory(browser).pipe(
      Effect.mapError(
        (cause) => new BrowserSessionError({ phase: "open", cause }),
      ),
    );
    return {
      fetchPage: (pageNumber) =>
        doFetchPage(page, pageNumber).pipe(
          Effect.mapError(
            (cause) => new BrowserSessionError({ phase: "fetch", cause }),
          ),
        ),
    };
  });
}

function openInventory(browser: Browser): Effect.Effect<Page, Error> {
  return Effect.gen(function* () {
    const context =
      browser.contexts()[0] ??
      (yield* Effect.tryPromise({
        try: () => browser.newContext(),
        catch: toError,
      }));
    const page =
      context.pages()[0] ??
      (yield* Effect.tryPromise({
        try: () => context.newPage(),
        catch: toError,
      }));
    yield* Effect.tryPromise({
      try: () =>
        page.goto(`${UPULLIT_DAVIE_ORIGIN}/inventory`, {
          waitUntil: "networkidle",
          timeout: 60_000,
        }),
      catch: toError,
    });
    return page;
  });
}

function doFetchPage(
  page: Page,
  pageNumber: number,
): Effect.Effect<UpullitDaviePage, unknown> {
  return Effect.gen(function* () {
    const result = yield* Effect.tryPromise(() =>
      page.evaluate(
        async ({ requestedPage, timeoutMs }) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(
            () =>
              controller.abort(
                new Error(
                  `U Pull It Davie inventory request timed out after ${timeoutMs}ms`,
                ),
              ),
            timeoutMs,
          );
          try {
            const response = await fetch(
              `/api/inventory/search?page=${encodeURIComponent(String(requestedPage))}`,
              {
                cache: "no-store",
                headers: { Accept: "application/json" },
                signal: controller.signal,
              },
            );
            if (!response.ok) {
              return { ok: false as const, status: response.status };
            }
            const body: unknown = await response.json();
            return { ok: true as const, body };
          } finally {
            clearTimeout(timeoutId);
          }
        },
        {
          requestedPage: pageNumber,
          timeoutMs: BROWSER_REQUEST_TIMEOUT_MS,
        },
      ),
    );

    if (!result.ok) {
      return yield* Effect.fail(
        new Error(
          `U Pull It Davie inventory page ${pageNumber} returned HTTP ${result.status}`,
        ),
      );
    }

    return yield* Schema.decodeUnknown(UpullitDaviePageSchema)(
      result.body,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new Error(
            `U Pull It Davie inventory page ${pageNumber} returned invalid JSON: ${cause.message}`,
          ),
      ),
    );
  });
}
