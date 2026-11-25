import { afterEach, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { fetchScottsPage } from "./scotts-client";
import { SCOTTS_ROOT } from "./scotts-yard-metadata";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

test("Scotts refuses denial, rate limit, redirect, partial body and invalid UTF-8 without retry", async () => {
  const responses = [
    new Response("denied", { status: 403 }),
    new Response("limited", { status: 429, headers: { "retry-after": "300" } }),
    new Response("moved", {
      status: 302,
      headers: { location: "https://example.com" },
    }),
    new Response("partial", {
      headers: { "content-type": "text/html", "content-range": "bytes0-7/99" },
    }),
    new Response("short", {
      headers: { "content-type": "text/html", "content-length": "100" },
    }),
    new Response(new Uint8Array([255]), {
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
      Effect.runPromise(fetchScottsPage(SCOTTS_ROOT)),
    ).rejects.toThrow("prior inventory is preserved");
    expect(requests).toBe(1);
  }
});

test("Scotts never fetches held arrivals, hidden APIs, donor leaves, images or foreign controls", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response("unexpected");
    },
    { preconnect: original.preconnect },
  );
  for (const url of [
    SCOTTS_ROOT + "latest-arrivals/",
    SCOTTS_ROOT + "inventory/",
    SCOTTS_ROOT + "wp-admin/admin-ajax.php",
    SCOTTS_ROOT + "used-parts/ACURA/CL/200165/1997",
    SCOTTS_ROOT + "used-parts/ACURA?all=1",
    "https://example.com/used-parts/ACURA",
  ])
    await expect(Effect.runPromise(fetchScottsPage(url))).rejects.toThrow(
      "outside the finite",
    );
  expect(requests).toBe(0);
});

test("Scotts interruption aborts transport and releases a stalled response reader", async () => {
  let announce = () => {};
  const fetched = new Promise<void>((resolve) => {
    announce = resolve;
  });
  let cancelled = false;
  let signal: AbortSignal | null = null;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal ?? null;
      announce();
      return new Response(stream, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  const fiber = Effect.runFork(fetchScottsPage(SCOTTS_ROOT));
  await fetched;
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(signal).toMatchObject({ aborted: true });
  expect(cancelled).toBe(true);
  expect(stream.locked).toBe(false);
});
