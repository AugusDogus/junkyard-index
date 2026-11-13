import { afterEach, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { fetchKodakPage } from "./kodak-client";
import { KODAK_HOME } from "./kodak-yard-metadata";

const originalFetch = globalThis.fetch;
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("interruption aborts transport and releases a stalled response body", async () => {
  let announce = () => {};
  const fetched = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const signals: AbortSignal[] = [];
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init?.signal) throw new Error("Missing cancellation signal");
      signals.push(init.signal);
      announce();
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  const fiber = Effect.runFork(fetchKodakPage(KODAK_HOME, gate));
  await fetched;
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(signals[0]?.aborted).toBe(true);
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});

test("interruption aborts pending headers without retrying", async () => {
  let announce = () => {};
  const fetched = new Promise<void>((resolve) => {
    announce = resolve;
  });
  let cancelled = false;
  let requests = 0;
  globalThis.fetch = Object.assign(
    (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests++;
      if (!init?.signal) throw new Error("Missing cancellation signal");
      const signal = init.signal;
      announce();
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            cancelled = true;
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const fiber = Effect.runFork(fetchKodakPage(KODAK_HOME, gate));
  await fetched;
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(cancelled).toBe(true);
  expect(requests).toBe(1);
});

test("refused HTTP envelopes cancel unread response bodies", async () => {
  const envelopes: ResponseInit[] = [
    { status: 302, headers: { "content-type": "text/html" } },
    {
      headers: { "content-type": "text/html", "content-range": "bytes 0-2/9" },
    },
    { headers: { "content-type": "application/json" } },
  ];
  for (const envelope of envelopes) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    globalThis.fetch = Object.assign(async () => new Response(body, envelope), {
      preconnect: originalFetch.preconnect,
    });
    await expect(
      Effect.runPromise(fetchKodakPage(KODAK_HOME, gate)),
    ).rejects.toThrow();
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  }
});

test("failed cancellation preserves the primary HTTP refusal and cleanup diagnosis", async () => {
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      throw new Error("Kodak cancellation refused");
    },
  });
  globalThis.fetch = Object.assign(
    async () =>
      new Response(body, {
        status: 302,
        headers: { "content-type": "text/html" },
      }),
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.either(fetchKodakPage(KODAK_HOME, gate)),
  );
  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left.cause).toBeInstanceOf(AggregateError);
    expect(result.left.message).toContain("302");
    expect(result.left.message).toContain("Kodak cancellation refused");
  }
  expect(body.locked).toBe(false);
});

test("actual streamed bytes enforce the cap and release the reader", async () => {
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
      new Response(body, {
        headers: { "content-type": "text/html" },
      }),
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    Effect.runPromise(fetchKodakPage(KODAK_HOME, gate)),
  ).rejects.toThrow("exceeds 2 MiB");
  expect(pulls).toBe(9);
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});

test("invalid UTF-8 is rejected before parsing", async () => {
  globalThis.fetch = Object.assign(
    async () =>
      new Response(new Uint8Array([255]), {
        headers: { "content-type": "text/html" },
      }),
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    Effect.runPromise(fetchKodakPage(KODAK_HOME, gate)),
  ).rejects.toThrow();
});
