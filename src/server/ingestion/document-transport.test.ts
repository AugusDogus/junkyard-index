import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { fetchBigdPage } from "./bigd-client";
import {
  DocumentTransport,
  type BrowserDocumentMode,
  type BrowserDocumentPage,
} from "./document-transport";
import type { ProviderRequestGate } from "./provider-http-client";
import { fetchSix03Page } from "./six03-client";
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
