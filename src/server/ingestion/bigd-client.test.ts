import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import {
  BIGD_MAX_RESPONSE_BYTES,
  bigdRequestGate,
  fetchBigdPage,
  type BigdSession,
} from "./bigd-client";
import type { ProviderRequestGate } from "./provider-http-client";
const originalFetch = globalThis.fetch;
const direct: ProviderRequestGate = (request) => request;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function mock(
  run: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
) {
  return spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(run, { preconnect: originalFetch.preconnect }),
  );
}
test("negotiates only the public bootstrap cookie with the qualified request headers", async () => {
  const session: BigdSession = { cookie: null };
  const calls: RequestInit[] = [];
  mock(async (_input, init) => {
    if (init) calls.push(init);
    return calls.length === 1
      ? new Response("<html>Public session</html>", {
          status: 403,
          headers: {
            "content-type": "text/html",
            "cf-mitigated": "challenge",
            "set-cookie":
              "__cf_bm=public-fixture-cookie; HttpOnly; Secure; Path=/",
          },
        })
      : new Response("<html>Inventory</html>", {
          headers: { "content-type": "text/html" },
        });
  });
  await Effect.runPromise(fetchBigdPage("/", session, direct));
  await Effect.runPromise(fetchBigdPage("/inventory/", session, direct));
  expect(calls[1]).toMatchObject({
    redirect: "manual",
    headers: {
      "User-Agent": "JunkyardIndex/1.0",
      "Accept-Encoding": "identity",
      Connection: "close",
      Cookie: "__cf_bm=public-fixture-cookie",
    },
  });
});
test.each([
  [
    "challenge inventory",
    () =>
      new Response("blocked", {
        status: 403,
        headers: {
          "content-type": "text/html",
          "cf-mitigated": "challenge",
          "set-cookie": "__cf_bm=public; Path=/",
        },
      }),
  ],
  [
    "redirect",
    () =>
      new Response("", {
        status: 302,
        headers: {
          location: "https://example.com",
          "content-type": "text/html",
        },
      }),
  ],
  [
    "partial",
    () =>
      new Response("partial", {
        status: 206,
        headers: { "content-type": "text/html" },
      }),
  ],
  [
    "range",
    () =>
      new Response("partial", {
        headers: {
          "content-type": "text/html",
          "content-range": "bytes 0-4/20",
        },
      }),
  ],
  [
    "MIME",
    () =>
      new Response("{}", { headers: { "content-type": "application/json" } }),
  ],
  [
    "oversized",
    () =>
      new Response("x".repeat(BIGD_MAX_RESPONSE_BYTES + 1), {
        headers: { "content-type": "text/html" },
      }),
  ],
  [
    "length mismatch",
    () =>
      new Response("short", {
        headers: { "content-type": "text/html", "content-length": "2000" },
      }),
  ],
  [
    "invalid UTF-8",
    () =>
      new Response(new Uint8Array([0xff]), {
        headers: { "content-type": "text/html" },
      }),
  ],
] as const)("fails closed on %s without retries", async (_name, response) => {
  const fetcher = mock(async () => response());
  await expect(
    Effect.runPromise(fetchBigdPage("/inventory/", { cookie: null }, direct)),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
test("does not accept a bootstrap challenge without its public session cookie", async () => {
  mock(
    async () =>
      new Response("blocked", {
        status: 403,
        headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
      }),
  );
  await expect(
    Effect.runPromise(fetchBigdPage("/", { cookie: null }, direct)),
  ).rejects.toThrow();
});

test("keeps a completed four-second gap across concurrent requests, including failures", async () => {
  let failedAt = 0,
    nextStartedAt = 0;
  await Effect.runPromise(
    Effect.all(
      [
        bigdRequestGate(
          Effect.sync(() => {
            failedAt = Date.now();
          }).pipe(Effect.zipRight(Effect.fail(new Error("network failure")))),
        ).pipe(Effect.either),
        bigdRequestGate(
          Effect.sync(() => {
            nextStartedAt = Date.now();
          }),
        ).pipe(Effect.either),
      ],
      { concurrency: "unbounded" },
    ),
  );
  expect(nextStartedAt - failedAt).toBeGreaterThanOrEqual(3900);
}, 15000);
