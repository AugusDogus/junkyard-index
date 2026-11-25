import { afterEach, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { fetchCentralPage } from "./central-client";
import { CENTRAL_ROOT } from "./central-yard-metadata";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

test("Central preserves the HTTP refusal when unread-body cleanup also fails", async () => {
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      throw new Error("cleanup transport failed");
    },
  });
  globalThis.fetch = Object.assign(
    async () =>
      new Response(stream, {
        status: 302,
        headers: { "content-type": "text/html" },
      }),
    { preconnect: original.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.either(fetchCentralPage(CENTRAL_ROOT)),
  );
  expect(result._tag).toBe("Left");
  if (result._tag !== "Left")
    throw new Error("Refused response unexpectedly succeeded");
  expect(result.left.message).toContain("received 302");
  expect(result.left.message).toContain("body also failed");
  const cause = result.left.cause;
  expect(cause).toBeInstanceOf(AggregateError);
  if (!(cause instanceof AggregateError))
    throw new Error("Missing original and cleanup error causes");
  expect(cause.errors).toHaveLength(2);
  expect(cause.errors[1]).toBeInstanceOf(Error);
});

test("Central interruption aborts transport and releases a stalled body reader before returning", async () => {
  const signals: AbortSignal[] = [];
  let announce = () => {};
  const fetched = new Promise<void>((resolve) => {
    announce = resolve;
  });
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Missing source cancellation signal");
      signals.push(signal);
      announce();
      return new Response(stream, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  const fiber = Effect.runFork(fetchCentralPage(CENTRAL_ROOT));
  await fetched;
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(signals[0]?.aborted).toBe(true);
  expect(cancelled).toBe(true);
  expect(stream.locked).toBe(false);
});

test("Central interruption aborts a pending header request without retry", async () => {
  let announce = () => {};
  const fetched = new Promise<void>((resolve) => {
    announce = resolve;
  });
  let cancelled = false;
  let requests = 0;
  globalThis.fetch = Object.assign(
    (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests++;
      const signal = init?.signal;
      if (!signal) throw new Error("Missing source cancellation signal");
      announce();
      return new Promise((_resolve, reject) =>
        signal.addEventListener(
          "abort",
          () => {
            cancelled = true;
            reject(signal.reason);
          },
          { once: true },
        ),
      );
    },
    { preconnect: original.preconnect },
  );
  const fiber = Effect.runFork(fetchCentralPage(CENTRAL_ROOT));
  await fetched;
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(cancelled).toBe(true);
  expect(requests).toBe(1);
});

test("Central cancels unread bodies when refusing redirect, partial or foreign MIME responses", async () => {
  const envelopes: ResponseInit[] = [
    { status: 302, headers: { "content-type": "text/html" } },
    {
      status: 200,
      headers: { "content-type": "text/html", "content-range": "bytes0-2/9" },
    },
    { status: 200, headers: { "content-type": "application/json" } },
  ];
  for (const envelope of envelopes) {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    globalThis.fetch = Object.assign(
      async () => new Response(stream, envelope),
      { preconnect: original.preconnect },
    );
    await expect(
      Effect.runPromise(fetchCentralPage(CENTRAL_ROOT)),
    ).rejects.toThrow("Expected complete");
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  }
});

test("Central cancels streaming bodies at the actual 2 MiB boundary without retry", async () => {
  let pulls = 0;
  let cancelled = false;
  let requests = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      controller.enqueue(new Uint8Array(1024 * 1024).fill(65));
      if (pulls === 8) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response(stream, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  await expect(
    Effect.runPromise(fetchCentralPage(CENTRAL_ROOT)),
  ).rejects.toThrow("exceeds 2 MiB");
  expect(requests).toBe(1);
  expect(cancelled).toBe(true);
  expect(pulls).toBeLessThan(6);
});

test("Central refuses redirects, partial bodies, foreign MIME and malformed UTF-8 without retry", async () => {
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
      Effect.runPromise(fetchCentralPage(CENTRAL_ROOT)),
    ).rejects.toThrow("prior inventory is preserved");
    expect(requests).toBe(1);
  }
});

test("Central does not fetch hidden inventory failures, donor details, images or foreign routes", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response("unexpected");
    },
    { preconnect: original.preconnect },
  );
  for (const url of [
    "https://centralautoliq.com/inventory/",
    "https://centralautoliq.com/used-parts/ACURA/ILX/RR116/2020",
    "https://example.com/parts/",
    "https://centralautoliq.com/used-parts/ACURA?all=1",
  ])
    await expect(Effect.runPromise(fetchCentralPage(url))).rejects.toThrow(
      "outside the finite",
    );
  expect(requests).toBe(0);
});
