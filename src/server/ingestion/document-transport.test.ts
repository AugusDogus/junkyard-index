import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect, Exit } from "effect";
import { acquireBigdBrowser, fetchBigdPage } from "./bigd-client";
import { streamBigdInventory } from "./bigd-connector";
import { Config } from "./context";
import {
  DocumentTransport,
  type BrowserDocumentMode,
  type BrowserDocumentPage,
  type BrowserRoute,
  type BrowserSessions,
} from "./document-transport";
import { BrowserSessionError } from "./errors";
import { streamNorthwestInventory } from "./northwest-connector";
import { NORTHWEST_ROOT } from "./northwest-yard-metadata";
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

test("a prepared page routes every request and drops only rendering subresources", async () => {
  const routes: string[] = [];
  const handlers: ((route: BrowserRoute) => Promise<void>)[] = [];
  await DocumentTransport.preparePage({
    route: async (url, handler) => {
      routes.push(url);
      handlers.push(handler);
    },
  });
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
    for (const handle of handlers)
      await handle({
        request: () => ({ resourceType: () => type }),
        abort: async () => {
          outcomes[type] = "abort";
        },
        continue: async () => {
          outcomes[type] = "continue";
        },
      });
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

/** Remote sessions that record every lifecycle call. */
function fakeSessions(
  page: BrowserDocumentPage,
  connectFailure: Error | null = null,
) {
  const events: string[] = [];
  let created = 0;
  const sessions: BrowserSessions = {
    create: async () => {
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
          yield* transport.pipe(
            Effect.flatMap((documents) =>
              fetchBigdPage(path, { cookie: null }, direct, documents),
            ),
          );
        expect(events).toEqual(["create s1", "connect"]);
      }),
    ),
  );
  expect(events).toEqual(["create s1", "connect", "disconnect", "stop s1"]);
});

test("a refused request still stops the session", async () => {
  const { sessions, events } = fakeSessions(servingPage(refused));
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const transport = yield* acquireBigdBrowser(sessions);
        yield* transport.pipe(
          Effect.flatMap((documents) =>
            fetchBigdPage("/inventory/", { cookie: null }, direct, documents),
          ),
        );
      }),
    ),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(events).toEqual(["create s1", "connect", "disconnect", "stop s1"]);
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
        yield* transport.pipe(
          Effect.flatMap((documents) =>
            fetchBigdPage("/", { cookie: null }, direct, documents),
          ),
        );
      }),
    ).pipe(Effect.timeout("50 millis")),
  );
  expect(Exit.isFailure(exit)).toBe(true);
  expect(events).toEqual(["create s1", "connect", "disconnect", "stop s1"]);
});

test("a failed browser connection still stops the created session", async () => {
  const failure = new Error("CDP connect timed out");
  const { sessions, events } = fakeSessions(servingPage(), failure);
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      acquireBigdBrowser(sessions).pipe(Effect.flatMap((open) => open)),
    ),
  );
  expect(exit).toEqual(
    Exit.fail(new BrowserSessionError({ phase: "open", cause: failure })),
  );
  expect(events).toEqual(["create s1", "stop s1"]);
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
  expect(events).toEqual(["create s1", "connect", "disconnect", "stop s1"]);
});
