import { Hyperbrowser } from "@hyperbrowser/sdk";
import { chromium } from "playwright-core";
import { Effect, Scope, SynchronizedRef } from "effect";
import { BrowserSessionError } from "./errors";
import { IPULLUPULL_MAX_RESPONSE_BYTES } from "./ipullupull-response-text";

/** The part of a fetch Response that native HTML clients validate. Clients
 * keep owning status, redirect, URL, MIME, range and body checks. */
export interface DocumentResponse {
  readonly status: number;
  readonly url: string;
  readonly redirected: boolean;
  readonly headers: Headers;
  readonly body: Response["body"];
}

export interface DocumentRequestInit {
  readonly signal: AbortSignal;
  readonly headers: Readonly<Record<string, string>>;
}

/** One unredirected GET for one HTML document. */
export type DocumentTransport = (
  url: string,
  init: DocumentRequestInit,
) => Promise<DocumentResponse>;

/** `navigation` loads every document as a top-level page load. `fetch` loads
 * the first document on an origin by navigation, then uses same-origin
 * in-page fetch for later documents on that origin. */
export type BrowserDocumentMode = "navigation" | "fetch";

interface BrowserNavigationRequest {
  redirectedFrom(): BrowserNavigationRequest | null;
  response(): Promise<BrowserNavigationResponse | null>;
}

interface BrowserNavigationResponse {
  status(): number;
  url(): string;
  headersArray(): Promise<{ name: string; value: string }[]>;
  body(): Promise<Buffer>;
  request(): BrowserNavigationRequest;
}

interface InPageRequest {
  readonly url: string;
  readonly accept: string;
  readonly timeoutMs: number;
  readonly maximumBytes: number;
}

interface InPageDocument {
  readonly status: number;
  readonly url: string;
  readonly redirected: boolean;
  readonly headers: [string, string][];
  /** Base64 of the exact body bytes, so clients keep their UTF-8 check. */
  readonly body: string | null;
}

/** The Playwright page surface the browser transport uses. */
export interface BrowserDocumentPage {
  url(): string;
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number },
  ): Promise<BrowserNavigationResponse | null>;
  evaluate(
    run: (request: InPageRequest) => Promise<InPageDocument>,
    request: InPageRequest,
  ): Promise<InPageDocument>;
}

const BROWSER_REQUEST_TIMEOUT_MS = 30_000;
// Past every client's own limit, so each client's bounded reader still refuses
// an oversized document; this only keeps the page from buffering without end.
const IN_PAGE_MAX_BYTES = IPULLUPULL_MAX_RESPONSE_BYTES + 1;
const CDP_CONNECT_TIMEOUT_MS = 45_000;
// A backstop for a session whose stop call fails; chunks end within minutes.
const SESSION_TIMEOUT_MINUTES = 10;

const native: DocumentTransport = (url, init) =>
  fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: init.signal,
    headers: { ...init.headers },
  });

function abortable<A>(signal: AbortSignal, run: () => Promise<A>): Promise<A> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<A>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    run()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Copies the bytes into a stream a fetch Response body can hold. */
function bodyStream(bytes: Uint8Array): NonNullable<Response["body"]> {
  const copy = new Uint8Array(bytes);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(copy);
      controller.close();
    },
  });
}

/** Playwright joins repeated headers with newlines; keep them separate. */
async function navigationHeaders(
  response: BrowserNavigationResponse | null,
): Promise<Headers> {
  const headers = new Headers();
  for (const { name, value } of (await response?.headersArray()) ?? [])
    headers.append(name, value);
  return headers;
}

/** Report a redirected navigation as its first hop, as a manual-redirect
 * fetch would, so the client's status check refuses it. */
async function navigationDocument(
  response: BrowserNavigationResponse,
): Promise<DocumentResponse> {
  let first = response.request();
  for (
    let previous = first.redirectedFrom();
    previous;
    previous = previous.redirectedFrom()
  )
    first = previous;
  if (first !== response.request()) {
    const hop = await first.response();
    return {
      status: hop?.status() ?? 0,
      url: response.url(),
      redirected: true,
      headers: await navigationHeaders(hop),
      body: null,
    };
  }
  return {
    status: response.status(),
    url: response.url(),
    redirected: false,
    headers: await navigationHeaders(response),
    body: bodyStream(await response.body()),
  };
}

// Serialized into the page. It must not reference module scope.
async function fetchInPage(request: InPageRequest): Promise<InPageDocument> {
  const response = await fetch(request.url, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: request.accept },
    signal: AbortSignal.timeout(request.timeoutMs),
  });
  const headers: [string, string][] = [];
  response.headers.forEach((value, name) => headers.push([name, value]));
  let body: string | null = null;
  const reader =
    response.type === "opaqueredirect" ? undefined : response.body?.getReader();
  if (reader) {
    let binary = "";
    let bytes = 0;
    try {
      while (bytes < request.maximumBytes) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const kept = chunk.value.subarray(0, request.maximumBytes - bytes);
        bytes += kept.byteLength;
        for (let start = 0; start < kept.length; start += 8192)
          binary += String.fromCharCode(...kept.subarray(start, start + 8192));
      }
    } finally {
      await reader.cancel();
    }
    body = btoa(binary);
  }
  return {
    status: response.status,
    url: response.url,
    redirected: response.redirected,
    headers,
    body,
  };
}

/** Request headers other than Accept are left to the browser, which owns
 * cookies, user agent and compression for the session. */
function browser(
  page: BrowserDocumentPage,
  mode: BrowserDocumentMode,
): DocumentTransport {
  return (url, init) =>
    abortable(init.signal, async () => {
      const target = new URL(url).origin;
      const current = URL.parse(page.url())?.origin;
      if (mode === "fetch" && current === target) {
        const document = await page.evaluate(fetchInPage, {
          url,
          accept: init.headers["Accept"] ?? "text/html",
          timeoutMs: BROWSER_REQUEST_TIMEOUT_MS,
          maximumBytes: IN_PAGE_MAX_BYTES,
        });
        return {
          status: document.status,
          url: document.url,
          redirected: document.redirected,
          headers: new Headers(document.headers),
          body:
            document.body === null
              ? null
              : bodyStream(Buffer.from(document.body, "base64")),
        };
      }
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: BROWSER_REQUEST_TIMEOUT_MS,
      });
      if (!response)
        throw new Error(
          `Browser navigation to ${url} returned no document response; the page did not load a new document.`,
        );
      return navigationDocument(response);
    });
}

/** A transport that a connector resolves at each request site, inside any
 * shared host turn. A browser transport opens its session on first use. */
export type LazyDocumentTransport = Effect.Effect<
  DocumentTransport,
  BrowserSessionError
>;

/** A connected session page and how to disconnect from it. */
export interface BrowserConnection {
  readonly page: BrowserDocumentPage;
  close(): Promise<void>;
}

/** The remote browser calls behind one session, replaceable in tests. */
export interface BrowserSessions {
  /** Starts one billed remote session. */
  create(): Promise<{ readonly id: string; readonly wsEndpoint: string }>;
  /** Ends billing for a session. */
  stop(id: string): Promise<unknown>;
  /** Connects to a session and returns its prepared page. */
  connect(wsEndpoint: string): Promise<BrowserConnection>;
}

/** The Playwright routing surface `preparePage` uses. */
export interface BrowserRoute {
  request(): { resourceType(): string };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

export interface BrowserRoutablePage {
  route(
    url: string,
    handler: (route: BrowserRoute) => Promise<void>,
  ): Promise<void>;
}

// Rendering-only subresources, which would otherwise load outside the client
// gate and host slot. Documents, scripts, stylesheets and XHR still load, so a
// page still behaves as it does in a normal browser.
const BLOCKED_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "image",
  "media",
  "font",
]);

/** Routes every request of the page. Playwright disables the browser HTTP
 * cache while routing is on, so every document request reaches the site as a
 * native fetch would, and a closing check never reads a cached copy of the
 * page it compares against. */
function preparePage(page: BrowserRoutablePage): Promise<void> {
  return page.route("**/*", (route) =>
    BLOCKED_RESOURCE_TYPES.has(route.request().resourceType())
      ? route.abort()
      : route.continue(),
  );
}

/** Hyperbrowser sessions with stealth and accepted cookies only: no proxy
 * and no CAPTCHA solving. */
function hyperbrowser(apiKey: string): BrowserSessions {
  const client = new Hyperbrowser({ apiKey });
  return {
    create: () =>
      client.sessions.create({
        useStealth: true,
        useProxy: false,
        solveCaptchas: false,
        acceptCookies: true,
        region: "us-west",
        timeoutMinutes: SESSION_TIMEOUT_MINUTES,
      }),
    stop: (id) => client.sessions.stop(id),
    connect: async (wsEndpoint) => {
      const connected = await chromium.connectOverCDP(wsEndpoint, {
        timeout: CDP_CONNECT_TIMEOUT_MS,
      });
      try {
        const context =
          connected.contexts()[0] ?? (await connected.newContext());
        const page = context.pages()[0] ?? (await context.newPage());
        await preparePage(page);
        return { page, close: () => connected.close() };
      } catch (cause) {
        await connected.close().catch(() => undefined);
        throw cause;
      }
    },
  };
}

/** One session page for the enclosing scope, stopped when it closes. */
function acquirePage(sessions: BrowserSessions) {
  return Effect.gen(function* () {
    const session = yield* Effect.acquireRelease(
      Effect.tryPromise(() => sessions.create()),
      (s) =>
        Effect.tryPromise(() => sessions.stop(s.id)).pipe(
          Effect.catchAll((cause) =>
            Effect.logWarning(
              `Hyperbrowser session ${s.id} did not stop: ${String(cause.error)}. It ends after its ${SESSION_TIMEOUT_MINUTES}-minute timeout; stop it in the Hyperbrowser dashboard to end billing sooner.`,
            ),
          ),
        ),
    );
    const connection = yield* Effect.acquireRelease(
      Effect.tryPromise(() => sessions.connect(session.wsEndpoint)),
      (c) => Effect.promise(() => c.close().catch(() => undefined)),
    );
    return connection.page;
  }).pipe(
    Effect.mapError(
      (cause) => new BrowserSessionError({ phase: "open", cause: cause.error }),
    ),
  );
}

/** A browser transport for the enclosing scope whose session opens on first
 * use, so a chunk that sends no request, or still waits for a shared host
 * turn, holds no billed session. A failed or interrupted open leaves the next
 * use to try again, and the scope still releases whatever it acquired. */
function acquireBrowser(
  sessions: BrowserSessions,
  mode: BrowserDocumentMode,
): Effect.Effect<LazyDocumentTransport, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const opened = yield* SynchronizedRef.make<DocumentTransport | null>(null);
    const keep = (
      transport: DocumentTransport,
    ): [DocumentTransport, DocumentTransport] => [transport, transport];
    return SynchronizedRef.modifyEffect(opened, (current) =>
      current
        ? Effect.succeed(keep(current))
        : acquirePage(sessions).pipe(
            Scope.extend(scope),
            Effect.map((page) => keep(browser(page, mode))),
          ),
    );
  });
}

export const DocumentTransport = {
  native,
  /** The native transport as a `LazyDocumentTransport`. */
  nativeLazy: Effect.succeed(native) satisfies LazyDocumentTransport,
  browser,
  preparePage,
  hyperbrowser,
  acquireBrowser,
} as const;
