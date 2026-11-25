import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { fetchAviationPage } from "./aviation-client";
import { AVIATION_ROOT } from "./aviation-yard-metadata";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

test("Aviation refuses redirects, partial bodies, foreign MIME and malformed UTF-8 without retry", async () => {
  const responses = [
    new Response("moved", {
      status: 302,
      headers: { location: "https://example.com" },
    }),
    new Response("partial", {
      status: 200,
      headers: { "content-type": "text/html", "content-range": "bytes0-7/99" },
    }),
    new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
    new Response("short", {
      status: 200,
      headers: { "content-type": "text/html", "content-length": "100" },
    }),
    new Response(new Uint8Array([255]), {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  ];
  for (const response of responses) {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return response;
      },
      { preconnect: original.preconnect },
    );
    await expect(
      Effect.runPromise(fetchAviationPage(AVIATION_ROOT)),
    ).rejects.toThrow("prior inventory is preserved");
    expect(requests).toBe(1);
  }
});

test("Aviation does not fetch hidden inventory failures, donor details, images or foreign routes", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response("unexpected");
    },
    { preconnect: original.preconnect },
  );
  for (const url of [
    "https://aviationauto.com/inventory/",
    "https://aviationauto.com/used-parts/ACURA/ILX/RR116/2020",
    "https://example.com/parts/",
    "https://aviationauto.com/used-parts/ACURA?all=1",
  ])
    await expect(Effect.runPromise(fetchAviationPage(url))).rejects.toThrow(
      "outside the finite",
    );
  expect(requests).toBe(0);
});
