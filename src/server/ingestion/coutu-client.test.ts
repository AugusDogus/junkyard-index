import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { fetchCoutuPage } from "./coutu-client";
import { COUTU_ROOT } from "./coutu-protocol";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
test("Coutu refuses redirects, partial bodies, foreign MIME and malformed UTF-8 without retry", async () => {
  for (const response of [
    new Response("moved", {
      status: 302,
      headers: { location: "https://example.com" },
    }),
    new Response("partial", {
      headers: { "content-type": "text/html", "content-range": "bytes0-7/99" },
    }),
    new Response("{}", { headers: { "content-type": "application/json" } }),
    new Response("short", {
      headers: { "content-type": "text/html", "content-length": "100" },
    }),
    new Response(new Uint8Array([255]), {
      headers: { "content-type": "text/html" },
    }),
  ]) {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return response;
      },
      { preconnect: original.preconnect },
    );
    await expect(
      Effect.runPromise(fetchCoutuPage(COUTU_ROOT, gate)),
    ).rejects.toThrow("prior inventory is preserved");
    expect(requests).toBe(1);
  }
});

test("Coutu enforces 2 MiB while streaming and cancels the oversized body", async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(256 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  globalThis.fetch = Object.assign(
    async () =>
      new Response(body, { headers: { "content-type": "text/html" } }),
    { preconnect: original.preconnect },
  );
  await expect(
    Effect.runPromise(fetchCoutuPage(COUTU_ROOT, gate)),
  ).rejects.toThrow("exceeds 2 MiB");
  expect(pulls).toBe(9);
  expect(cancelled).toBe(true);
});

test("Coutu never fetches donor details, images, component categories or foreign routes", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response("unexpected");
    },
    { preconnect: original.preconnect },
  );
  for (const url of [
    "https://www.truckcountry.us/browse/vehicle/123",
    "https://truckcountry.s3.amazonaws.com/vehicle/123.jpg",
    "https://www.truckcountry.us/browse/ford/f250/engine",
    "https://example.com/browse",
    COUTU_ROOT + "?page=2",
  ])
    await expect(Effect.runPromise(fetchCoutuPage(url, gate))).rejects.toThrow(
      "outside the finite",
    );
  expect(requests).toBe(0);
});
