import { Hyperbrowser } from "@hyperbrowser/sdk";
import { chromium } from "playwright-core";
import {
  Effect,
  ExecutionStrategy,
  Exit,
  Scope,
  SynchronizedRef,
} from "effect";
import { BrowserSessionError } from "./errors";
import {
  HyperbrowserSessions,
  type HyperbrowserSource,
} from "./hyperbrowser-sessions";
import { IPULLUPULL_MAX_RESPONSE_BYTES } from "./ipullupull-response-text";
import type {
  ProviderCapacityDeferred,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";

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
  /** How long a browser may keep loading the document, which `signal` cannot
   * stop inside the page: 30 seconds unless set. Native requests end with
   * `signal` alone. */
  readonly timeoutMs?: number;
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
      const timeoutMs = init.timeoutMs ?? BROWSER_REQUEST_TIMEOUT_MS;
      const target = new URL(url).origin;
      const current = URL.parse(page.url())?.origin;
      if (mode === "fetch" && current === target) {
        const document = await page.evaluate(fetchInPage, {
          url,
          accept: init.headers["Accept"] ?? "text/html",
          timeoutMs,
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
        timeout: timeoutMs,
      });
      if (!response)
        throw new Error(
          `Browser navigation to ${url} returned no document response; the page did not load a new document.`,
        );
      return navigationDocument(response);
    });
}

/** Why a browser transport has no session: the session lease or the plan's
 * concurrent sessions are busy (the chunk is deferred), or opening failed. */
export type BrowserOpenError =
  | BrowserSessionError
  | ProviderTurnDeferred
  | ProviderCapacityDeferred;

/** A transport that a connector resolves at each request site. A browser
 * transport takes its session lease, then opens its session, on first use. */
export interface LazyDocumentTransport {
  /** Takes the session lease without opening a session; later calls are
   * free. A connector that requests inside shared host turns takes it before
   * its first turn, so no turn holder waits for the lease. */
  readonly lease: Effect.Effect<void, BrowserOpenError>;
  /** The transport, taking the lease and opening the session on first use. */
  readonly open: Effect.Effect<DocumentTransport, BrowserOpenError>;
}

/** A connected session page and how to disconnect from it. */
export interface BrowserConnection {
  readonly page: BrowserDocumentPage;
  close(): Promise<void>;
}

/** The remote browser calls behind one session, replaceable in tests. */
export interface BrowserSessions {
  /** Holds a place among the account's concurrent sessions for the enclosing
   * scope, without starting a session. */
  readonly lease: Effect.Effect<
    void,
    ProviderTurnDeferred | BrowserSessionError,
    Scope.Scope
  >;
  /** Starts one billed remote session. */
  create(): Promise<{ readonly id: string; readonly wsEndpoint: string }>;
  /** Ends billing for a session. */
  stop(id: string): Promise<unknown>;
  /** Connects to a session and returns its prepared page. */
  connect(wsEndpoint: string): Promise<BrowserConnection>;
}

/** The Playwright routing surface `preparePage` uses. */
export interface BrowserRoute {
  request(): {
    resourceType(): string;
    url(): string;
    isNavigationRequest(): boolean;
    frame(): { parentFrame(): unknown };
  };
  abort(): Promise<void>;
  continue(): Promise<void>;
}

export interface BrowserRoutablePage extends BrowserDocumentPage {
  route(
    url: string,
    handler: (route: BrowserRoute) => Promise<void>,
  ): Promise<void>;
}

/** What a session page loads besides the transport's own documents.
 * `page`: the page's scripts, stylesheets and the requests they make, so it
 * behaves as in a normal browser; images, media and fonts are aborted.
 * `none`: nothing but Cloudflare's `/cdn-cgi/` resources, which its edge
 * serves without reaching the site, so every request that reaches the site is
 * a document the client reads inside its gate and host slot. */
export type BrowserSubresources = "page" | "none";

// Rendering-only subresources, which would otherwise load outside the client
// gate and host slot.
const RENDERING_RESOURCE_TYPES: ReadonlySet<string> = new Set([
  "image",
  "media",
  "font",
]);

const normalized = (url: string) => URL.parse(url)?.href ?? url;

/**
 * Routes every request of the page and returns the page the transport uses.
 * Playwright disables the browser HTTP cache while routing is on, so every
 * document request reaches the site as a native fetch would, and a closing
 * check never reads a cached copy of the page it compares against. With
 * `none`, a request loads only if it is a main-frame navigation, the in-page
 * fetch the returned page is sending for a document, or a Cloudflare
 * `/cdn-cgi/` resource.
 */
async function preparePage(
  page: BrowserRoutablePage,
  subresources: BrowserSubresources,
): Promise<BrowserDocumentPage> {
  // URLs the transport is reading by in-page fetch right now.
  const reading = new Set<string>();
  const loads = (request: ReturnType<BrowserRoute["request"]>) => {
    switch (subresources) {
      case "page":
        return !RENDERING_RESOURCE_TYPES.has(request.resourceType());
      case "none":
        return (
          (request.isNavigationRequest() &&
            request.frame().parentFrame() === null) ||
          (request.resourceType() === "fetch" &&
            reading.has(normalized(request.url()))) ||
          URL.parse(request.url())?.pathname.startsWith("/cdn-cgi/") === true
        );
    }
  };
  await page.route("**/*", (route) =>
    loads(route.request()) ? route.continue() : route.abort(),
  );
  return {
    url: () => page.url(),
    goto: (url, options) => page.goto(url, options),
    evaluate: async (run, request) => {
      const url = normalized(request.url);
      reading.add(url);
      try {
        return await page.evaluate(run, request);
      } finally {
        reading.delete(url);
      }
    },
  };
}

/** `source`'s Hyperbrowser sessions, under the cross-source session lease,
 * with stealth and accepted cookies only: no proxy and no CAPTCHA solving.
 * Their pages load `subresources` besides the transport's documents. The SDK
 * client, which refuses a missing key, is built by the first session create,
 * so a chunk that opens no session never needs the key. */
function hyperbrowser(
  apiKey: string,
  source: HyperbrowserSource,
  subresources: BrowserSubresources,
): BrowserSessions {
  let built: Hyperbrowser | undefined;
  const client = () => (built ??= new Hyperbrowser({ apiKey }));
  return {
    lease: HyperbrowserSessions.lease(source),
    create: async () =>
      HyperbrowserSessions.create(client(), {
        useStealth: true,
        useProxy: false,
        solveCaptchas: false,
        acceptCookies: true,
        region: "us-west",
      }),
    stop: async (id) => client().sessions.stop(id),
    connect: async (wsEndpoint) => {
      const connected = await chromium.connectOverCDP(wsEndpoint, {
        timeout: CDP_CONNECT_TIMEOUT_MS,
      });
      try {
        const context =
          connected.contexts()[0] ?? (await connected.newContext());
        const page = context.pages()[0] ?? (await context.newPage());
        return {
          page: await preparePage(page, subresources),
          close: () => connected.close(),
        };
      } catch (cause) {
        await connected.close().catch(() => undefined);
        throw cause;
      }
    },
  };
}

/** One session page for the enclosing scope, stopped when it closes. The
 * plan's concurrent session refusal defers the chunk. A failed open stops the
 * session it created at once, so it is neither billed until the scope closes
 * nor counted against the plan when the next use creates another. */
function acquirePage(
  sessions: BrowserSessions,
): Effect.Effect<
  BrowserDocumentPage,
  BrowserSessionError | ProviderCapacityDeferred,
  Scope.Scope
> {
  return Effect.gen(function* () {
    const attempt = yield* Scope.fork(
      yield* Effect.scope,
      ExecutionStrategy.sequential,
    );
    return yield* openPage(sessions).pipe(
      Scope.extend(attempt),
      Effect.onError((cause) => Scope.close(attempt, Exit.failCause(cause))),
    );
  });
}

function openPage(
  sessions: BrowserSessions,
): Effect.Effect<
  BrowserDocumentPage,
  BrowserSessionError | ProviderCapacityDeferred,
  Scope.Scope
> {
  return Effect.gen(function* () {
    const session = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => sessions.create(),
        catch: (cause) =>
          HyperbrowserSessions.capacityDeferral(cause) ??
          new BrowserSessionError({ phase: "open", cause }),
      }),
      (s) =>
        Effect.tryPromise(() => sessions.stop(s.id)).pipe(
          Effect.catchAll((cause) =>
            Effect.logWarning(
              `Hyperbrowser session ${s.id} did not stop: ${String(cause.error)}. Hyperbrowser ends it at its session timeout; stop it in the Hyperbrowser dashboard to end billing sooner.`,
            ),
          ),
        ),
    );
    const connection = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: () => sessions.connect(session.wsEndpoint),
        catch: (cause) => new BrowserSessionError({ phase: "open", cause }),
      }),
      (c) => Effect.promise(() => c.close().catch(() => undefined)),
    );
    return connection.page;
  });
}

/** A browser transport for the enclosing scope that takes its session lease,
 * then opens its session, on first use. A chunk that sends no request holds
 * neither, and one still waiting for the lease or a shared host turn holds no
 * billed session. A failed or interrupted lease or open leaves the next use
 * to try again, and the scope releases whatever it acquired: the session
 * first, then the lease. */
function acquireBrowser(
  sessions: BrowserSessions,
  mode: BrowserDocumentMode,
): Effect.Effect<LazyDocumentTransport, never, Scope.Scope> {
  return Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const leased = yield* SynchronizedRef.make(false);
    const lease = SynchronizedRef.updateEffect(leased, (held) =>
      held
        ? Effect.succeed(true)
        : sessions.lease.pipe(Scope.extend(scope), Effect.as(true)),
    );
    const opened = yield* SynchronizedRef.make<DocumentTransport | null>(null);
    const keep = (
      transport: DocumentTransport,
    ): [DocumentTransport, DocumentTransport] => [transport, transport];
    const open = lease.pipe(
      Effect.zipRight(
        SynchronizedRef.modifyEffect(opened, (current) =>
          current
            ? Effect.succeed(keep(current))
            : acquirePage(sessions).pipe(
                Scope.extend(scope),
                Effect.map((page) => keep(browser(page, mode))),
              ),
        ),
      ),
    );
    return { lease, open };
  });
}

export const DocumentTransport = {
  native,
  /** The native transport as a `LazyDocumentTransport`: no lease and no
   * session. */
  nativeLazy: {
    lease: Effect.void,
    open: Effect.succeed(native),
  } satisfies LazyDocumentTransport,
  browser,
  preparePage,
  hyperbrowser,
  acquireBrowser,
} as const;
