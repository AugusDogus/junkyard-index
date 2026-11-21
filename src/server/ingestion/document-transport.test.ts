import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect, Either, Exit } from "effect";
import { acquireBigdBrowser, fetchBigdPage } from "./bigd-client";
import { streamBigdInventory } from "./bigd-connector";
import { Config } from "./context";
import {
  DocumentTransport,
  type BrowserDocumentMode,
  type BrowserDocumentPage,
  type BrowserRoutablePage,
  type BrowserRoute,
  type BrowserSessions,
  type LazyDocumentTransport,
} from "./document-transport";
import { BrowserSessionError } from "./errors";
import { fetchNorthwestPage } from "./northwest-client";
import { streamNorthwestInventory } from "./northwest-connector";
import {
  NORTHWEST_MAKES,
  NORTHWEST_ORIGIN,
  NORTHWEST_ROOT,
} from "./northwest-yard-metadata";
import {
  ProviderCapacityDeferred,
  ProviderChunkClock,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";
import { withProviderHostLease } from "./provider-host-slot";
import { runWithQueuedHost } from "./provider-host-test-support";
import type { ProviderRequestGate } from "./provider-http-client";
import { fetchSix03Page } from "./six03-client";
import { streamSix03Inventory } from "./six03-connector";
import { SIX03_CATALOG, SIX03_CONTACT } from "./six03-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const direct: ProviderRequestGate = (request) => request;
const html = "<!doctype html><html><body>Native</body></html>";

interface Hop {
  status: number;
  url: string;
  headers: Record<string, string>;
  body?: string;
}
interface Request {
  redirectedFrom(): Request | null;
  response(): Promise<Navigation | null>;
}
interface Navigation {
  status(): number;
  url(): string;
  headersArray(): Promise<{ name: string; value: string }[]>;
  body(): Promise<Buffer>;
  request(): Request;
}

/** A Playwright navigation response whose request followed `redirects` first. */
function navigation(final: Hop, redirects: Hop[] = []): Navigation {
  let from: Request | null = null;
  const respond = (hop: Hop): Navigation => {
    const previous = from;
    const request: Request = {
      redirectedFrom: () => previous,
      response: async () => response,
    };
    const response: Navigation = { ...stub(hop), request: () => request };
    from = request;
    return response;
  };
  redirects.forEach(respond);
  return respond(final);
}
const stub = (hop: Hop) => ({
  status: () => hop.status,
  url: () => hop.url,
  headersArray: async () =>
    Object.entries(hop.headers).map(([name, value]) => ({ name, value })),
  body: async () => Buffer.from(hop.body ?? ""),
});

function fakePage(
  mode: BrowserDocumentMode,
  navigate: (url: string) => Navigation | null,
) {
  let current = "about:blank";
  const log: string[] = [];
  const page: BrowserDocumentPage = {
    url: () => current,
    goto: async (url) => {
      log.push("goto " + url);
      current = url;
      return navigate(url);
    },
    // Runs the serialized in-page function against the mocked global fetch.
    evaluate: async (run, request) => {
      log.push("fetch " + request.url);
      return run(request);
    },
  };
  return { transport: DocumentTransport.browser(page, mode), log };
}

const ok = (url: string, headers = { "content-type": "text/html" }) =>
  navigation({ status: 200, url, headers, body: html });

test("navigation mode returns the native status, URL, headers and raw bytes", async () => {
  const url = "https://bigdsalvage.com/contact/";
  const { transport } = fakePage("navigation", ok);
  const response = await transport(url, {
    signal: AbortSignal.timeout(1000),
    headers: { Accept: "text/html" },
  });
  expect(response.status).toBe(200);
  expect(response.url).toBe(url);
  expect(response.redirected).toBe(false);
  expect(response.headers.get("content-type")).toBe("text/html");
  expect(await new Response(response.body).text()).toBe(html);
});

test("navigation mode loads every document by navigation, even on the same origin", async () => {
  const { transport, log } = fakePage("navigation", ok);
  await Effect.runPromise(
    fetchBigdPage("/", { cookie: null }, direct, transport),
  );
  await Effect.runPromise(
    fetchBigdPage("/inventory/", { cookie: null }, direct, transport),
  );
  expect(log).toEqual([
    "goto https://bigdsalvage.com/",
    "goto https://bigdsalvage.com/inventory/",
  ]);
});

test("navigation mode reports a redirect as its first hop so the client refuses it", async () => {
  const { transport } = fakePage("navigation", (url) =>
    navigation(
      {
        status: 200,
        url: "https://bigdsalvage.com/",
        headers: { "content-type": "text/html" },
        body: html,
      },
      [{ status: 301, url, headers: { location: "https://bigdsalvage.com/" } }],
    ),
  );
  const response = await transport("https://bigdsalvage.com/contact/", {
    signal: AbortSignal.timeout(1000),
    headers: {},
  });
  expect(response).toMatchObject({
    status: 301,
    redirected: true,
    url: "https://bigdsalvage.com/",
    body: null,
  });
  await expect(
    Effect.runPromise(
      fetchBigdPage("/contact/", { cookie: null }, direct, transport),
    ),
  ).rejects.toThrow("received 301");
});

test.each([
  [
    "Cloudflare challenge",
    {
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
    },
    "received 403",
  ],
  [
    "foreign MIME",
    { status: 200, headers: { "content-type": "application/json" } },
    "received 200",
  ],
] as const)(
  "the Big D client refuses a browser %s",
  async (_name, hop, message) => {
    const { transport } = fakePage("navigation", (url) =>
      navigation({ ...hop, url, body: html }),
    );
    await expect(
      Effect.runPromise(
        fetchBigdPage("/inventory/", { cookie: null }, direct, transport),
      ),
    ).rejects.toThrow(message);
  },
);

test("navigation without a document response fails closed", async () => {
  const { transport } = fakePage("navigation", () => null);
  await expect(
    transport("https://bigdsalvage.com/", {
      signal: AbortSignal.timeout(1000),
      headers: {},
    }),
  ).rejects.toThrow("returned no document response");
});

test("fetch mode navigates to a new origin once, then uses unredirected same-origin fetch", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response(html, { headers: { "content-type": "text/html" } });
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  const { transport, log } = fakePage("fetch", ok);
  expect(
    await Effect.runPromise(fetchSix03Page(SIX03_CONTACT, direct, transport)),
  ).toBe(html);
  expect(
    await Effect.runPromise(fetchSix03Page(SIX03_CATALOG, direct, transport)),
  ).toBe(html);
  expect(log).toEqual(["goto " + SIX03_CONTACT, "fetch " + SIX03_CATALOG]);
  expect(calls).toHaveLength(1);
  expect(calls[0]?.init).toMatchObject({
    redirect: "manual",
    credentials: "same-origin",
    headers: { Accept: "text/html" },
  });
});

test.each([
  [
    "redirect",
    () =>
      new Response(null, {
        status: 302,
        headers: {
          location: "https://example.com/",
          "content-type": "text/html",
        },
      }),
    "received 302",
  ],
  [
    "challenge",
    () =>
      new Response("blocked", {
        status: 403,
        headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      }),
    "received 403",
  ],
  [
    "foreign MIME",
    () =>
      new Response("{}", { headers: { "content-type": "application/json" } }),
    "received 200",
  ],
  [
    "partial range",
    () =>
      new Response(html, {
        headers: {
          "content-type": "text/html",
          "content-range": "bytes 0-4/20",
        },
      }),
    "received 200",
  ],
] as const)(
  "the Six03 client refuses an in-page fetch %s",
  async (_name, response, message) => {
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(async () => response(), {
        preconnect: originalFetch.preconnect,
      }),
    );
    const { transport } = fakePage("fetch", ok);
    await Effect.runPromise(fetchSix03Page(SIX03_CONTACT, direct, transport));
    await expect(
      Effect.runPromise(fetchSix03Page(SIX03_CATALOG, direct, transport)),
    ).rejects.toThrow(message);
  },
);

test("an aborted request settles without waiting for the browser", async () => {
  const page: BrowserDocumentPage = {
    url: () => "about:blank",
    goto: () => new Promise(() => {}),
    evaluate: () => new Promise(() => {}),
  };
  const lifetime = new AbortController();
  const pending = DocumentTransport.browser(page, "navigation")(
    "https://bigdsalvage.com/",
    { signal: lifetime.signal, headers: {} },
  );
  lifetime.abort(new Error("chunk deadline"));
  await expect(pending).rejects.toThrow("chunk deadline");
});

test("navigation keeps repeated response headers as separate values", async () => {
  const page: BrowserDocumentPage = {
    url: () => "about:blank",
    goto: async (url) => ({
      ...ok(url),
      headersArray: async () => [
        { name: "content-type", value: "text/html" },
        { name: "set-cookie", value: "a=1; Path=/" },
        { name: "set-cookie", value: "b=2; Path=/" },
      ],
    }),
    evaluate: () => Promise.reject(new Error("unexpected in-page fetch")),
  };
  const response = await DocumentTransport.browser(page, "navigation")(
    "https://bigdsalvage.com/",
    { signal: AbortSignal.timeout(1000), headers: {} },
  );
  expect(response.headers.getSetCookie()).toEqual([
    "a=1; Path=/",
    "b=2; Path=/",
  ]);
});

test("in-page fetch carries exact body bytes, so the client still refuses invalid UTF-8", async () => {
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () =>
        new Response(new Uint8Array([0x3c, 0xff, 0x3e]), {
          headers: { "content-type": "text/html" },
        }),
      { preconnect: originalFetch.preconnect },
    ),
  );
  const { transport } = fakePage("fetch", ok);
  await Effect.runPromise(fetchSix03Page(SIX03_CONTACT, direct, transport));
  await expect(
    Effect.runPromise(fetchSix03Page(SIX03_CATALOG, direct, transport)),
  ).rejects.toThrow("utf-8");
});

interface RoutedRequest {
  type: string;
  url?: string;
  navigation?: boolean;
  subframe?: boolean;
}

/** A routable page that reports what its route handler does with each
 * request, including the in-page fetch it sends while reading a document. */
function routedPage() {
  const routes: string[] = [];
  let handler: ((route: BrowserRoute) => Promise<void>) | null = null;
  const send = async ({
    type,
    url = NORTHWEST_ORIGIN + "/wp-content/plugins/urg/app.js",
    navigation = false,
    subframe = false,
  }: RoutedRequest) => {
    let outcome = "unrouted";
    await handler?.({
      request: () => ({
        resourceType: () => type,
        url: () => url,
        isNavigationRequest: () => navigation,
        frame: () => ({ parentFrame: () => (subframe ? {} : null) }),
      }),
      abort: async () => {
        outcome = "abort";
      },
      continue: async () => {
        outcome = "continue";
      },
    });
    return outcome;
  };
  let read = "unread";
  const page: BrowserRoutablePage = {
    url: () => "about:blank",
    goto: async () => null,
    evaluate: async (_run, request) => {
      read = await send({ type: "fetch", url: request.url });
      return {
        status: 200,
        url: request.url,
        redirected: false,
        headers: [],
        body: null,
      };
    },
    route: async (url, route) => {
      routes.push(url);
      handler = route;
    },
  };
  return { page, routes, send, read: () => read };
}

test("a prepared page that keeps page subresources routes every request and drops only rendering ones", async () => {
  const { page, routes, send } = routedPage();
  await DocumentTransport.preparePage(page, "page");
  // Playwright disables the HTTP cache while any route is on, so routing
  // every URL is what keeps repeated navigations off the browser cache.
  expect(routes).toEqual(["**/*"]);
  const outcomes: Record<string, string> = {};
  for (const type of [
    "document",
    "script",
    "stylesheet",
    "xhr",
    "fetch",
    "image",
    "media",
    "font",
  ])
    outcomes[type] = await send({ type, navigation: type === "document" });
  expect(outcomes).toEqual({
    document: "continue",
    script: "continue",
    stylesheet: "continue",
    xhr: "continue",
    fetch: "continue",
    image: "abort",
    media: "abort",
    font: "abort",
  });
});

test("a prepared page without subresources loads only the transport's documents and Cloudflare's edge resources", async () => {
  const { page, routes, send, read } = routedPage();
  const prepared = await DocumentTransport.preparePage(page, "none");
  expect(routes).toEqual(["**/*"]);
  expect({
    navigation: await send({
      type: "document",
      url: NORTHWEST_ROOT,
      navigation: true,
    }),
    frame: await send({
      type: "document",
      url: NORTHWEST_ORIGIN + "/embed/",
      navigation: true,
      subframe: true,
    }),
    script: await send({ type: "script" }),
    stylesheet: await send({ type: "stylesheet" }),
    xhr: await send({
      type: "xhr",
      url: NORTHWEST_ORIGIN + "/wp-admin/admin-ajax.php",
    }),
    pageFetch: await send({ type: "fetch", url: NORTHWEST_MAKES }),
    image: await send({ type: "image" }),
    challenge: await send({
      type: "script",
      url: NORTHWEST_ORIGIN + "/cdn-cgi/challenge-platform/scripts/jsd/main.js",
    }),
  }).toEqual({
    navigation: "continue",
    frame: "abort",
    script: "abort",
    stylesheet: "abort",
    xhr: "abort",
    pageFetch: "abort",
    image: "abort",
    challenge: "continue",
  });
  // The transport's own in-page fetch loads while it reads, and only then.
  await prepared.evaluate(() => Promise.reject(new Error("not run")), {
    url: NORTHWEST_MAKES,
    accept: "text/html",
    timeoutMs: 1000,
    maximumBytes: 1,
  });
  expect(read()).toBe("continue");
  expect(await send({ type: "fetch", url: NORTHWEST_MAKES })).toBe("abort");
});

const busy = new ProviderTurnDeferred({
  host: "Hyperbrowser session for test",
  stage: "wait",
  elapsedMs: 0,
  queuedMs: 0,
});

/** Remote sessions that record every lifecycle call, including the session
 * lease, which `lease` replaces. */
function fakeSessions(
  page: BrowserDocumentPage,
  connectFailure: Error | null = null,
  options: {
    lease?: BrowserSessions["lease"];
    createFailure?: Error;
  } = {},
) {
  const events: string[] = [];
  let created = 0;
  const sessions: BrowserSessions = {
    lease:
      options.lease ??
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push("lease");
        }),
        () =>
          Effect.sync(() => {
            events.push("release");
          }),
      ),
    create: async () => {
      if (options.createFailure) throw options.createFailure;
      created++;
      events.push("create s" + created);
      return { id: "s" + created, wsEndpoint: "wss://browser/" + created };
    },
    stop: async (id) => {
      events.push("stop " + id);
    },
    connect: async () => {
      if (connectFailure) throw connectFailure;
      events.push("connect");
      return {
        page,
        close: async () => {
          events.push("disconnect");
        },
      };
    },
  };
  return { sessions, events };
}

const servingPage = (
  respond: (url: string) => Navigation | null = ok,
): BrowserDocumentPage => {
  let current = "about:blank";
  return {
    url: () => current,
    goto: async (url) => {
      current = url;
      return respond(url);
    },
    evaluate: () => Promise.reject(new Error("unexpected in-page fetch")),
  };
};
/** A session's whole life: the lease is taken before the session is created
 * and released after it stops. */
const lifecycle = [
  "lease",
  "create s1",
  "connect",
  "disconnect",
  "stop s1",
  "release",
];
const refused = (url: string) =>
  navigation({ status: 403, url, headers: { "content-type": "text/html" } });

test("a browser transport opens no session until its first request", async () => {
  const { sessions, events } = fakeSessions(servingPage());
  await Effect.runPromise(Effect.scoped(acquireBigdBrowser(sessions)));
  expect(events).toEqual([]);
});

test("a browser transport opens one session on first use, reuses it, and stops it with the scope", async () => {
  const { sessions, events } = fakeSessions(servingPage());
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* acquireBigdBrowser(sessions);
        for (const path of ["/", "/inventory/"] as const)
          yield* transport.open.pipe(
            Effect.flatMap((documents) =>
              fetchBigdPage(path, { cookie: null }, direct, documents),
            ),
          );
        expect(events).toEqual(["lease", "create s1", "connect"]);
      }),
    ),
  );
  expect(events).toEqual(lifecycle);
});

test("a refused request still stops the session", async () => {
  const { sessions, events } = fakeSessions(servingPage(refused));
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* acquireBigdBrowser(sessions);
        yield* transport.open.pipe(
          Effect.flatMap((documents) =>
            fetchBigdPage("/inventory/", { cookie: null }, direct, documents),
          ),
        );
      }),
    ),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(events).toEqual(lifecycle);
});

test("an interrupted request still stops the session", async () => {
  const { sessions, events } = fakeSessions({
    url: () => "about:blank",
    goto: () => new Promise(() => {}),
    evaluate: () => new Promise(() => {}),
  });
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* acquireBigdBrowser(sessions);
        yield* transport.open.pipe(
          Effect.flatMap((documents) =>
            fetchBigdPage("/", { cookie: null }, direct, documents),
          ),
        );
      }),
    ).pipe(Effect.timeout("50 millis")),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(events).toEqual(lifecycle);
});

test("a failed browser connection still stops the created session", async () => {
  const failure = new Error("CDP connect timed out");
  const { sessions, events } = fakeSessions(servingPage(), failure);
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      acquireBigdBrowser(sessions).pipe(
        Effect.flatMap((transport) => transport.open),
      ),
    ),
  );
  expect(exit).toEqual(
    Exit.fail(new BrowserSessionError({ phase: "open", cause: failure })),
  );
  expect(events).toEqual(["lease", "create s1", "stop s1", "release"]);
});

const config = { betterStackHeartbeatUrl: undefined, hyperbrowserApiKey: "" };
const ignore = () => Effect.void;

test.each([
  [
    "Big D with an invalid budget",
    (sessions: BrowserSessions) =>
      streamBigdInventory({ maxPages: 5, onBatch: ignore }, sessions).pipe(
        Effect.asVoid,
      ),
  ],
  [
    "Northwest with an invalid budget",
    (sessions: BrowserSessions) =>
      streamNorthwestInventory({ maxPages: 9, onBatch: ignore }, sessions).pipe(
        Effect.asVoid,
      ),
  ],
  [
    "603 with an invalid budget",
    (sessions: BrowserSessions) =>
      streamSix03Inventory({ maxPages: 9, onBatch: ignore }, sessions).pipe(
        Effect.asVoid,
      ),
  ],
] as const)("%s opens no session", async (_name, run) => {
  const { sessions, events } = fakeSessions(servingPage());
  const exit = await Effect.runPromiseExit(
    run(sessions).pipe(Effect.provideService(Config, config)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(events).toEqual([]);
});

test("603 with a complete checkpoint opens no session", async () => {
  const { sessions, events } = fakeSessions(servingPage());
  const result = await Effect.runPromise(
    streamSix03Inventory(
      {
        startCursor: { source: "six03", version: 1, phase: "complete" },
        onBatch: ignore,
      },
      sessions,
    ).pipe(Effect.provideService(Config, config)),
  );
  expect(result.status).toBe("complete");
  expect(events).toEqual([]);
});

test("a Northwest chunk whose first document is refused stops its session", async () => {
  const { sessions, events } = fakeSessions(servingPage(refused));
  const exit = await Effect.runPromiseExit(
    streamNorthwestInventory({ onBatch: ignore }, sessions).pipe(
      Effect.provideService(Config, config),
    ),
  );
  expect(exit).toMatchObject({
    _tag: "Failure",
    cause: { error: { operation: NORTHWEST_ROOT } },
  });
  expect(events).toEqual(lifecycle);
});

test.each([
  [
    "Big D",
    (sessions: BrowserSessions) =>
      streamBigdInventory({ onBatch: ignore }, sessions).pipe(Effect.asVoid),
  ],
  [
    "Northwest",
    (sessions: BrowserSessions) =>
      streamNorthwestInventory({ onBatch: ignore }, sessions).pipe(
        Effect.asVoid,
      ),
  ],
  [
    "603",
    (sessions: BrowserSessions) =>
      streamSix03Inventory({ onBatch: ignore }, sessions).pipe(Effect.asVoid),
  ],
] as const)(
  "%s defers its chunk while the session lease is busy, without a session or request",
  async (_name, run) => {
    const { sessions, events } = fakeSessions(servingPage(), null, {
      lease: Effect.fail(busy),
    });
    const failure = await Effect.runPromise(
      run(sessions).pipe(Effect.provideService(Config, config)),
    ).catch((error: unknown) => error);
    expect(ProviderChunkClock.deferralOf(failure)).toBe(busy);
    expect(events).toEqual([]);
  },
);

test("the plan's concurrent session refusal defers the chunk and releases the lease", async () => {
  // As @hyperbrowser/sdk 0.83 throws it.
  const refusal = Object.assign(
    new Error(
      "[Hyperbrowser]: Maximum number of active sessions (1) reached. Please close some sessions before creating new ones.",
    ),
    { name: "HyperbrowserError", statusCode: 429 },
  );
  const { sessions, events } = fakeSessions(servingPage(), null, {
    createFailure: refusal,
  });
  const failure = await Effect.runPromise(
    streamSix03Inventory({ onBatch: ignore }, sessions).pipe(
      Effect.provideService(Config, config),
    ),
  ).catch((error: unknown) => error);
  expect(ProviderChunkClock.deferralOf(failure)).toBeInstanceOf(
    ProviderCapacityDeferred,
  );
  expect(events).toEqual(["lease", "release"]);
});

test("Northwest takes the session lease before its URG turn and opens the session inside it", async () => {
  // A real lease, which refuses to wait inside a held shared host turn.
  const { sessions, events } = fakeSessions(servingPage(refused), null, {
    lease: withProviderHostLease(
      {
        key: "hyperbrowser:northwest",
        label: "Hyperbrowser session for northwest",
        leaseMs: 11 * 60_000,
        waitMs: 60_000,
        pollMs: 1000,
      },
      {
        reserve: async () => {
          events.push("lease");
          return true;
        },
        release: async () => {
          events.push("release");
          return true;
        },
        cancel: async () => true,
      },
    ).pipe(
      Effect.mapError(
        (cause) => new BrowserSessionError({ phase: "lease", cause }),
      ),
    ),
  });
  const run = await runWithQueuedHost(
    streamNorthwestInventory({ onBatch: ignore }, sessions).pipe(
      Effect.provideService(Config, config),
    ),
    { turnWaitMs: 60_000 },
  );
  // The refused root fails the chunk after one URG turn, not the lease.
  expect(Either.isLeft(run.result) && run.result.left).toMatchObject({
    operation: NORTHWEST_ROOT,
  });
  expect(run.turns).toHaveLength(1);
  expect(events).toEqual(lifecycle);
}, 60_000);

const northwestEnvelope = (content: string) =>
  `<!doctype html><html><head><script>var urgid = 'AK01'; var iisHomeUrl = 'northwestautoparts.com';</script></head><body>${content}<footer>Northwest Auto Parts 5700 Camelot Drive Anchorage, AK 99504 907-333-6531</footer></body></html>`;
const northwestDirectory = (controls: [path: string, label: string][]) =>
  northwestEnvelope(
    controls
      .map(
        ([path, label]) =>
          `<a class="iis-center-block" href="${NORTHWEST_ORIGIN + path}">${label} <span class="badge">200</span></a>`,
      )
      .join(""),
  );
/** The root, the make directory and one make's model menu. */
const northwestDocuments: Readonly<Record<string, string>> = {
  [NORTHWEST_ROOT]: northwestEnvelope(`<a href="${NORTHWEST_MAKES}">Parts</a>`),
  [NORTHWEST_MAKES]: northwestDirectory([["/parts/ACURA", "ACURA"]]),
  [NORTHWEST_ORIGIN + "/parts/ACURA"]: northwestDirectory([
    ["/parts/ACURA/MDX/", "MDX"],
    ["/parts/ACURA/RDX/", "RDX"],
  ]),
};

test("a Northwest chunk reads all its pages in one URG turn, so its session never waits in the URG queue", async () => {
  // In-page fetches reach this through the simulated queue's passthrough.
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const url = input instanceof Request ? input.url : String(input);
      const body = northwestDocuments[url];
      if (body === undefined) throw new Error("Unexpected request " + url);
      return new Response(body, {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  let current = "about:blank";
  const page: BrowserDocumentPage = {
    url: () => current,
    goto: async (url) => {
      current = url;
      return navigation({
        status: 200,
        url,
        headers: { "content-type": "text/html" },
        body: northwestDocuments[url] ?? "",
      });
    },
    evaluate: (run, request) => run(request),
  };
  const { sessions, events } = fakeSessions(page);
  const run = await runWithQueuedHost(
    streamNorthwestInventory({ maxPages: 3, onBatch: ignore }, sessions).pipe(
      Effect.provideService(Config, config),
    ),
    // Every turn waits a minute, as under 07:00 URG contention.
    { turnWaitMs: 60_000 },
  );
  expect(Either.isRight(run.result) && run.result.right).toMatchObject({
    status: "paused",
    pagesProcessed: 3,
  });
  expect(run.turns).toHaveLength(1);
  expect(events).toEqual(lifecycle);
}, 60_000);

test("Northwest opens its transport inside the request gate and keeps open deferrals as they are", async () => {
  const order: string[] = [];
  const gate: ProviderRequestGate = (request) =>
    Effect.sync(() => order.push("gate")).pipe(
      Effect.andThen(request),
      Effect.ensuring(Effect.sync(() => order.push("gate end"))),
    );
  const { transport } = fakePage("fetch", ok);
  const lazy: LazyDocumentTransport = {
    lease: Effect.void,
    open: Effect.sync(() => {
      order.push("open");
      return transport;
    }),
  };
  expect(
    await Effect.runPromise(fetchNorthwestPage(NORTHWEST_ROOT, gate, lazy)),
  ).toBe(html);
  expect(order).toEqual(["gate", "open", "gate end"]);
  const deferred = await Effect.runPromise(
    fetchNorthwestPage(NORTHWEST_ROOT, gate, {
      lease: Effect.void,
      open: Effect.fail(busy),
    }),
  ).catch((error: unknown) => error);
  expect(ProviderChunkClock.deferralOf(deferred)).toBe(busy);
});
