import { Hyperbrowser } from "@hyperbrowser/sdk";
import { chromium, type Page } from "playwright-core";
import { Deferred, Effect, Fiber, Option, type Scope } from "effect";
import { Config } from "./context";
import type { DocumentFetch } from "./document-fetch";
import {
  createHyperbrowserSession,
  HYPERBROWSER_BUSY_RETRY_MS,
  HYPERBROWSER_SETUP_MS,
  HyperbrowserCapacityError,
  withHyperbrowserSessionLease,
} from "./hyperbrowser-session";

/** Ceiling inside the page; each client still enforces its own smaller cap. */
const BROWSER_MAX_BODY_BYTES = 8 * 1024 * 1024;
const BROWSER_REQUEST_TIMEOUT_MS = 90_000;
const NAVIGATION_TIMEOUT_MS = 60_000;
/** Longest wait for the source's request gate (URG's shared host queue can
 * be minutes deep) before the origin navigation is sent. */
const NAVIGATION_QUEUE_MS = 150_000;
/** Origin navigation plus the source's document requests. With the setup cap
 * it fits the session hold (120 s + 480 s <= 630 s); the longest browser
 * chunk (URG IIS) keeps its own eight-minute deadline inside it. */
const BROWSER_CHUNK_WINDOW_MS = 8 * 60_000;
const CHALLENGE_WAIT_MS = 20_000;
/** From Hyperbrowser, Big D's Cloudflare zone challenges a minority of
 * same-origin fetches and passes a later identical one; a client then still
 * validates whichever answer comes back. */
const CHALLENGE_RETRIES = 2;
const CHALLENGE_RETRY_MS = 3_000;
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export type InPageResult =
  | { kind: "network"; message: string }
  | { kind: "redirect" }
  | { kind: "oversized" }
  | {
      kind: "response";
      status: number;
      url: string;
      headers: [string, string][];
      body: string;
    };

declare global {
  /** In-page fetches by request id, so a Node-side abort reaches the page. */
  var junkyardDocumentFetches: Map<string, AbortController> | undefined;
}

/** Runs inside the browser page. Must stay self-contained: Playwright sends
 * only its source. Manual redirects surface as opaque redirects. */
async function readInPage(input: {
  id: string;
  url: string;
  accept: string;
  maxBytes: number;
  timeoutMs: number;
}): Promise<InPageResult> {
  const controller = new AbortController();
  const pending = (globalThis.junkyardDocumentFetches ??= new Map());
  pending.set(input.id, controller);
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(input.url, {
      method: "GET",
      redirect: "manual",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: input.accept },
      signal: controller.signal,
    });
    if (response.type === "opaqueredirect") return { kind: "redirect" };
    const parts: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    while (reader) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > input.maxBytes) {
        await reader.cancel();
        return { kind: "oversized" };
      }
      parts.push(chunk.value);
    }
    let binary = "";
    for (const part of parts)
      for (let offset = 0; offset < part.length; offset += 0x8000)
        binary += String.fromCharCode(
          ...part.subarray(offset, offset + 0x8000),
        );
    return {
      kind: "response",
      status: response.status,
      url: response.url,
      headers: [...response.headers.entries()],
      body: btoa(binary),
    };
  } catch (error) {
    return { kind: "network", message: String(error) };
  } finally {
    clearTimeout(timer);
    pending.delete(input.id);
  }
}

/** Runs inside the browser page: abandons one in-flight document fetch. */
function abortInPage(id: string) {
  globalThis.junkyardDocumentFetches?.get(id)?.abort();
}

function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal | null | undefined,
) {
  if (!signal) return work;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

/** Converts an in-page result to a Response the clients validate as usual.
 * The browser already decoded the body, so encoding and length headers are
 * replaced with the decoded byte count. */
export function browserDocumentResponse(
  requestedUrl: string,
  result: InPageResult,
): Response {
  switch (result.kind) {
    case "network":
      // Same shape as a fetch transport rejection.
      throw new TypeError(
        `Browser fetch of ${requestedUrl} failed: ${result.message}`,
      );
    case "redirect":
      throw new Error(
        `${requestedUrl} redirected inside the browser session; redirects are refused`,
      );
    case "oversized":
      throw new Error(
        `${requestedUrl} exceeded ${BROWSER_MAX_BODY_BYTES} bytes inside the browser session`,
      );
    case "response": {
      if (URL.parse(result.url)?.href !== new URL(requestedUrl).href)
        throw new Error(
          `${requestedUrl} was answered from ${result.url} inside the browser session; other destinations are refused`,
        );
      const headers = new Headers(
        result.headers.filter(
          ([name]) =>
            ![
              "content-encoding",
              "content-length",
              "transfer-encoding",
            ].includes(name.toLowerCase()),
        ),
      );
      const body = Buffer.from(result.body, "base64");
      headers.set("content-length", String(body.byteLength));
      return new Response(NULL_BODY_STATUSES.has(result.status) ? null : body, {
        status: result.status,
        headers,
      });
    }
  }
}

/** A DocumentFetch that runs same-origin GETs inside `page`, which is already
 * on `origin`. Browser-controlled headers (User-Agent, Cookie, Sec-Fetch-*)
 * come from the browser; only Accept is forwarded. */
export function pageDocumentFetch(
  page: {
    evaluate(
      script: typeof readInPage,
      input: Parameters<typeof readInPage>[0],
    ): Promise<InPageResult>;
    evaluate(script: typeof abortInPage, id: string): Promise<void>;
  },
  origin: string,
  challengeRetryMs = CHALLENGE_RETRY_MS,
): DocumentFetch {
  return async (url, init) => {
    if (URL.parse(url)?.origin !== origin)
      throw new Error(
        `Browser session for ${origin} refused ${url}; open a session on that origin instead`,
      );
    if (
      (init.method ?? "GET") !== "GET" ||
      (init.body !== null && init.body !== undefined)
    )
      throw new Error(`Browser session for ${origin} only sends GET requests`);
    const accept = new Headers(init.headers).get("Accept") ?? "text/html";
    for (let attempt = 0; ; attempt++) {
      const id = crypto.randomUUID();
      // The client's deadline or interruption must stop the page's request
      // too, or a retry would overlap it on the same host.
      const abandon = () => {
        page.evaluate(abortInPage, id).catch((cause: unknown) => {
          console.error(
            `Could not abort the in-page request for ${url}; it ends at its ${BROWSER_REQUEST_TIMEOUT_MS / 1000}-second page timeout`,
            cause,
          );
        });
      };
      init.signal?.addEventListener("abort", abandon, { once: true });
      const result = await abortable(
        page.evaluate(readInPage, {
          id,
          url,
          accept,
          maxBytes: BROWSER_MAX_BODY_BYTES,
          timeoutMs: BROWSER_REQUEST_TIMEOUT_MS,
        }),
        init.signal,
      ).finally(() => init.signal?.removeEventListener("abort", abandon));
      if (attempt >= CHALLENGE_RETRIES || !isChallenge(result))
        return browserDocumentResponse(url, result);
      await abortable(
        new Promise((resolve) =>
          setTimeout(resolve, challengeRetryMs * (attempt + 1)),
        ),
        init.signal,
      );
    }
  };
}

const isChallenge = (result: InPageResult) =>
  result.kind === "response" &&
  result.status === 403 &&
  result.headers.some(
    ([name, value]) =>
      name.toLowerCase() === "cf-mitigated" && value === "challenge",
  );

/** Public cookies a source's direct requests already send, set on the origin
 * before navigation because page scripts cannot send a Cookie header. */
export type BrowserCookie = { name: string; value: string };

/** The Playwright page surface the origin navigation uses. */
export interface BrowserNavigationPage {
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<unknown>;
  waitForFunction(
    predicate: () => boolean,
    arg: null,
    options: { timeout: number },
  ): Promise<unknown>;
  close(): Promise<void>;
}

/** Admits one request to the yard: the source's pacing and, for a shared
 * backend, its host lease. Every `ProviderRequestGate` is one. */
export type BrowserNavigationGate = (
  request: Effect.Effect<void, Error>,
) => Effect.Effect<void, Error>;

/** Opens `origin` in `page` so its Cloudflare clearance and cookies apply to
 * later same-origin fetches. The navigation is a request to the yard like any
 * other, so it runs inside the source's request `gate` (its pacing and, for a
 * shared backend such as URG, the host lease).
 * - A gate that admits nothing within `queueMs` defers the chunk: nothing was
 *   requested from the yard.
 * - Once admitted, the navigation has its full load and challenge bounds. A
 *   Cloudflare challenge clears by reloading the yard's page, so its bounded
 *   wait stays inside the gate; an unchallenged page releases it on load.
 * - An interrupted navigation closes the page before the gate releases, so
 *   no browser request outlives the host lease. */
export function navigateBrowserPage(
  page: BrowserNavigationPage,
  origin: string,
  gate: BrowserNavigationGate,
  queueMs = NAVIGATION_QUEUE_MS,
): Effect.Effect<void, Error | HyperbrowserCapacityError> {
  const load = Effect.tryPromise({
    try: async () => {
      // A challenge answers this navigation with 403 and clears itself in a
      // real browser. Some sites keep challenging navigations while serving
      // same-origin fetches, so an uncleared challenge is not an error here:
      // every document request is validated by its client.
      await page.goto(origin + "/", {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });
      await page
        .waitForFunction(() => !/just a moment/i.test(document.title), null, {
          timeout: CHALLENGE_WAIT_MS,
        })
        .catch(() => undefined);
    },
    catch: (cause) =>
      new Error(`Could not open ${origin} in the browser session`, { cause }),
  }).pipe(
    Effect.onInterrupt(() =>
      Effect.promise(() => page.close().catch(() => undefined)),
    ),
  );
  return Effect.gen(function* () {
    const admitted = yield* Deferred.make<void>();
    const navigation = yield* Effect.fork(
      gate(Deferred.succeed(admitted, undefined).pipe(Effect.zipRight(load))),
    );
    const started = yield* Effect.raceFirst(
      Deferred.await(admitted),
      Fiber.await(navigation),
    ).pipe(Effect.timeoutOption(queueMs));
    if (Option.isNone(started)) {
      yield* Fiber.interrupt(navigation);
      return yield* Effect.fail(
        new HyperbrowserCapacityError({
          reason: `${origin}'s request gate admitted nothing for ${queueMs / 1000} seconds, so its browser chunk sent no request`,
          retryAfterMs: HYPERBROWSER_BUSY_RETRY_MS,
        }),
      );
    }
    return yield* Fiber.join(navigation);
  });
}

/** Opens a Hyperbrowser page with `cookies` set on `origin`. Must run under
 * the session lease; `withBrowserDocumentFetch` does both. Setup that
 * outlasts its cap defers the chunk: nothing was requested from the yard. */
function openBrowserPage(
  apiKey: string,
  origin: string,
  cookies: readonly BrowserCookie[],
): Effect.Effect<Page, Error | HyperbrowserCapacityError, Scope.Scope> {
  return Effect.gen(function* () {
    const client = new Hyperbrowser({ apiKey });
    const session = yield* Effect.acquireRelease(
      createHyperbrowserSession(client.sessions, {
        useStealth: true,
        acceptCookies: true,
        region: "us-west",
      }),
      (opened) =>
        Effect.promise(() =>
          client.sessions.stop(opened.id).then(
            () => undefined,
            (cause: unknown) =>
              console.error(
                `Could not stop Hyperbrowser session ${opened.id}; its ${origin} chunk result is unaffected and the session ends at its server-side timeout`,
                cause,
              ),
          ),
        ),
    );
    const browser = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          chromium.connectOverCDP(session.wsEndpoint, { timeout: 45_000 }),
        catch: (cause) =>
          new Error(`Could not connect to the ${origin} browser session`, {
            cause,
          }),
      }),
      (connected) => Effect.promise(() => connected.close().catch(() => {})),
    );
    return yield* Effect.tryPromise({
      try: async () => {
        const context = browser.contexts()[0] ?? (await browser.newContext());
        if (cookies.length > 0)
          await context.addCookies(
            cookies.map((cookie) => ({ ...cookie, url: origin + "/" })),
          );
        return context.pages()[0] ?? (await context.newPage());
      },
      catch: (cause) =>
        new Error(`Could not open a page in the ${origin} browser session`, {
          cause,
        }),
    });
  }).pipe(
    Effect.timeoutFail({
      duration: HYPERBROWSER_SETUP_MS,
      onTimeout: () =>
        new HyperbrowserCapacityError({
          reason: `starting the browser session for ${origin} took more than ${HYPERBROWSER_SETUP_MS / 1000} seconds, before any request to the yard`,
          retryAfterMs: HYPERBROWSER_BUSY_RETRY_MS,
        }),
    }),
  );
}

/** Holds the browser lease and one session on `origin` for `use`. The origin
 * navigation is sent through `gate`, the same request gate (pacing and host
 * lease) the source's document requests use. Navigation and `use` share
 * BROWSER_CHUNK_WINDOW_MS, so setup plus the window stays inside the session
 * hold. */
export function withBrowserDocumentFetch<A, E, R>(
  origin: string,
  gate: BrowserNavigationGate,
  use: (fetchDocument: DocumentFetch) => Effect.Effect<A, E, R>,
  cookies: readonly BrowserCookie[] = [],
): Effect.Effect<A, E | Error | HyperbrowserCapacityError, R | Config> {
  return Effect.flatMap(Config, (config) =>
    withHyperbrowserSessionLease(
      Effect.scoped(
        Effect.flatMap(
          openBrowserPage(config.hyperbrowserApiKey, origin, cookies),
          (page) =>
            navigateBrowserPage(page, origin, gate).pipe(
              Effect.zipRight(
                Effect.suspend(() => use(pageDocumentFetch(page, origin))),
              ),
              Effect.timeoutFail({
                duration: BROWSER_CHUNK_WINDOW_MS,
                onTimeout: () =>
                  new Error(
                    `The browser chunk on ${origin} (origin navigation and document requests) exceeded ${BROWSER_CHUNK_WINDOW_MS / 60_000} minutes. Its checkpoint and published inventory are unchanged; retry the chunk.`,
                  ),
              }),
            ),
        ),
      ),
    ),
  );
}
