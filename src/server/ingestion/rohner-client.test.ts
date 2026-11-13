import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { fetchRohnerPage } from "./rohner-client";
import { ROHNER_CATALOG } from "./rohner-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;

test.each<ResponseInit>([
  { status: 403, headers: { "content-type": "text/html" } },
  {
    status: 302,
    headers: { "content-type": "text/html", location: "https://example.com/" },
  },
  { status: 206, headers: { "content-type": "text/html" } },
  { headers: { "content-type": "application/json" } },
  {
    headers: { "content-type": "text/html", "content-range": "bytes 0-10/100" },
  },
  { headers: { "content-type": "text/html", "content-length": "1" } },
])(
  "Rohner rejects incomplete or redirected response envelopes without replay (%#)",
  async (init) => {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return new Response("<html></html>", init);
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(
      Effect.runPromise(fetchRohnerPage(ROHNER_CATALOG, gate)),
    ).rejects.toThrow("previous inventory is preserved");
    expect(requests).toBe(1);
  },
);

test("Rohner does not retry network failures, foreign final URLs, oversized bodies or invalid UTF-8", async () => {
  for (const mode of ["network", "url", "bytes", "utf8"]) {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        if (mode === "network") throw new TypeError("Network unavailable");
        const response = new Response(
          mode === "bytes"
            ? "x".repeat(2 * 1024 * 1024 + 1)
            : mode === "utf8"
              ? new Uint8Array([255])
              : "<html></html>",
          { headers: { "content-type": "text/html" } },
        );
        if (mode === "url")
          Object.defineProperty(response, "url", {
            value: "https://example.com/",
          });
        return response;
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(
      Effect.runPromise(fetchRohnerPage(ROHNER_CATALOG, gate)),
    ).rejects.toThrow("previous inventory is preserved");
    expect(requests).toBe(1);
  }
});

test("Rohner rejects unpublished destinations before the request gate", async () => {
  let gated = 0;
  const guarded = <A, E, R>(request: Effect.Effect<A, E, R>) => {
    gated++;
    return request;
  };
  for (const url of [
    "https://example.com/shop/aa0304/",
    "https://rohnersautoparts.com/shop/",
    "https://rohnersautoparts.com/shop/../",
    "https://rohnersautoparts.com/shop/aa0304/?x=1",
    "https://rohnersautoparts.com/shop/page/2/?product-categories=parts",
  ])
    await expect(
      Effect.runPromise(fetchRohnerPage(url, guarded)),
    ).rejects.toThrow("outside the bounded native vehicle catalog");
  expect(gated).toBe(0);
});
