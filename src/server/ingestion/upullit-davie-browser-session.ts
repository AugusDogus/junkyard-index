import { Hyperbrowser } from "@hyperbrowser/sdk";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import { Effect, Schema, Scope } from "effect";
import { BrowserSessionError } from "./errors";
import {
  UPULLIT_DAVIE_ORIGIN,
  type UpullitDaviePage,
  UpullitDaviePageSchema,
} from "./upullit-davie-client";

const CDP_CONNECT_TIMEOUT_MS = 45_000;
const BROWSER_REQUEST_TIMEOUT_MS = 30_000;
const HYPERBROWSER_REGION = "us-west" as const;

export interface UpullitDavieBrowserSession {
  fetchPage(
    pageNumber: number,
  ): Effect.Effect<UpullitDaviePage, BrowserSessionError>;
}

interface ManagedUpullitDavieSession {
  readonly session: UpullitDavieBrowserSession;
  readonly close: Effect.Effect<void, BrowserSessionError>;
}

interface MutableSessionState {
  readonly client: Hyperbrowser;
  browser: Browser | null;
  context: BrowserContext | null;
  page: Page | null;
  sessionId: string | null;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

export function acquireUpullitDavieSession(
  apiKey: string,
): Effect.Effect<UpullitDavieBrowserSession, BrowserSessionError, Scope.Scope> {
  return Effect.acquireRelease(openSession(apiKey), (managed) =>
    managed.close.pipe(Effect.catchAll(() => Effect.void)),
  ).pipe(Effect.map((managed) => managed.session));
}

function openSession(
  apiKey: string,
): Effect.Effect<ManagedUpullitDavieSession, BrowserSessionError> {
  return Effect.gen(function* () {
    const state: MutableSessionState = {
      client: new Hyperbrowser({ apiKey }),
      browser: null,
      context: null,
      page: null,
      sessionId: null,
    };

    yield* doOpen(state).pipe(
      Effect.tapError(() =>
        doClose(state).pipe(Effect.catchAll(() => Effect.void)),
      ),
      Effect.mapError(
        (cause) => new BrowserSessionError({ phase: "open", cause }),
      ),
    );

    const close = doClose(state).pipe(
      Effect.mapError(
        (cause) => new BrowserSessionError({ phase: "close", cause }),
      ),
    );
    const session: UpullitDavieBrowserSession = {
      fetchPage: (pageNumber) =>
        doFetchPage(state, pageNumber).pipe(
          Effect.mapError(
            (cause) => new BrowserSessionError({ phase: "fetch", cause }),
          ),
        ),
    };

    return { session, close };
  });
}

function doOpen(state: MutableSessionState): Effect.Effect<void, unknown> {
  return Effect.gen(function* () {
    const session = yield* Effect.tryPromise({
      try: () =>
        state.client.sessions.create({
          useStealth: true,
          acceptCookies: true,
          region: HYPERBROWSER_REGION,
        }),
      catch: toError,
    });
    state.sessionId = session.id;

    const browser = yield* Effect.tryPromise({
      try: () =>
        chromium.connectOverCDP(session.wsEndpoint, {
          timeout: CDP_CONNECT_TIMEOUT_MS,
        }),
      catch: toError,
    });
    state.browser = browser;

    const context =
      browser.contexts()[0] ??
      (yield* Effect.tryPromise(() => browser.newContext()));
    state.context = context;

    const page =
      context.pages()[0] ?? (yield* Effect.tryPromise(() => context.newPage()));
    state.page = page;

    yield* Effect.tryPromise(() =>
      page.goto(`${UPULLIT_DAVIE_ORIGIN}/inventory`, {
        waitUntil: "networkidle",
        timeout: 60_000,
      }),
    );
  }).pipe(Effect.asVoid);
}

function doFetchPage(
  state: MutableSessionState,
  pageNumber: number,
): Effect.Effect<UpullitDaviePage, unknown> {
  return Effect.gen(function* () {
    const page = state.page;
    if (!page) {
      return yield* Effect.fail(
        new Error("U Pull It Davie browser session is not open"),
      );
    }

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

    const sessionId = state.sessionId;
    if (sessionId) {
      yield* Effect.logInfo(
        `[U Pull It Davie] Hyperbrowser session: https://app.hyperbrowser.ai/sessions/${sessionId}`,
      );
      yield* Effect.tryPromise(() =>
        state.client.sessions.stop(sessionId).catch(() => undefined),
      );
      state.sessionId = null;
    }
  }).pipe(Effect.asVoid);
}
