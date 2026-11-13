import { afterEach, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { fetchMeeksPage } from "./meeks-client";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;

test("Meeks cancels unread HTTP, redirect, range and MIME refusals without retry", async () => {
  const envelopes: ResponseInit[] = [
    { status: 206, headers: { "content-type": "text/html" } },
    {
      status: 200,
      headers: {
        "content-type": "text/html",
        "content-range": "bytes 0-1/100",
      },
    },
    {
      status: 302,
      headers: {
        "content-type": "text/html",
        location: "https://example.com/",
      },
    },
    { status: 429, headers: { "content-type": "text/html" } },
    { status: 503, headers: { "content-type": "text/html" } },
    { status: 200, headers: { "content-type": "application/json" } },
  ];
  for (const envelope of envelopes) {
    let requests = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return new Response(stream, envelope);
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(Effect.runPromise(fetchMeeksPage("/", gate))).rejects.toThrow(
      "previous inventory is preserved",
    );
    expect(requests).toBe(1);
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  }
});

test("Meeks preserves both the HTTP refusal and a failed unread-body cancellation", async () => {
  globalThis.fetch = Object.assign(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            throw new Error("cleanup transport failed");
          },
        }),
        { status: 302 },
      ),
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.either(fetchMeeksPage("/", gate)),
  );
  if (result._tag !== "Left")
    throw new Error("Expected a typed source refusal");
  expect(result.left.cause).toBeInstanceOf(AggregateError);
  expect(result.left.message).toContain("received 302");
  expect(result.left.message).toContain("cancellation also failed");
});

test("Meeks interrupts stalled headers and body streams before returning", async () => {
  for (const phase of ["headers", "body"] as const) {
    let announce = () => {};
    const fetched = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const signals: AbortSignal[] = [];
    let bodyCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        bodyCancelled = true;
      },
    });
    let requests = 0;
    globalThis.fetch = Object.assign(
      (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        requests++;
        const requestSignal = init?.signal;
        if (!requestSignal)
          throw new Error("Missing source cancellation signal");
        signals.push(requestSignal);
        announce();
        if (phase === "body")
          return Promise.resolve(
            new Response(stream, { headers: { "content-type": "text/html" } }),
          );
        return new Promise((_resolve, reject) =>
          requestSignal.addEventListener(
            "abort",
            () => reject(requestSignal.reason),
            { once: true },
          ),
        );
      },
      { preconnect: originalFetch.preconnect },
    );
    const fiber = Effect.runFork(fetchMeeksPage("/", gate));
    await fetched;
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(signals[0]?.aborted).toBe(true);
    expect(requests).toBe(1);
    if (phase === "body") {
      expect(bodyCancelled).toBe(true);
      expect(stream.locked).toBe(false);
    }
  }
});

test("Meeks stops actual streamed bytes at 2 MiB and releases the reader", async () => {
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(1024 * 1024).fill(65));
    },
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = Object.assign(
    async () =>
      new Response(stream, { headers: { "content-type": "text/html" } }),
    { preconnect: originalFetch.preconnect },
  );
  await expect(Effect.runPromise(fetchMeeksPage("/", gate))).rejects.toThrow(
    "exceeds 2 MiB",
  );
  expect(cancelled).toBe(true);
  expect(stream.locked).toBe(false);
  expect(pulls).toBeLessThan(6);
});
