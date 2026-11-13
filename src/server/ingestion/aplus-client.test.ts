import { afterEach, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { fetchAplusPage } from "./aplus-client";
import { APLUS_ROOT } from "./aplus-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;

test("A Plus interruption aborts a stalled body and awaits reader release", async () => {
  const entered = Promise.withResolvers<void>();
  const cleanupStarted = Promise.withResolvers<void>();
  const releaseCleanup = Promise.withResolvers<void>();
  const signals: AbortSignal[] = [];
  let cancelled = false;
  let gateFinishedAfterCleanup = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        entered.resolve();
      },
      async cancel() {
        cleanupStarted.resolve();
        await releaseCleanup.promise;
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  globalThis.fetch = Object.assign(
    async (_input: string | URL | Request, init?: RequestInit) => {
      if (!init?.signal)
        throw new Error("Expected request cancellation signal");
      signals.push(init.signal);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  const fiber = Effect.runFork(
    fetchAplusPage(APLUS_ROOT, (request) =>
      request.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            gateFinishedAfterCleanup = cancelled && !body.locked;
          }),
        ),
      ),
    ),
  );
  await entered.promise;
  let interruptionFinished = false;
  const interrupted = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
    interruptionFinished = true;
  });
  await cleanupStarted.promise;
  expect(interruptionFinished).toBe(false);
  expect(body.locked).toBe(true);
  releaseCleanup.resolve();
  await interrupted;
  expect(signals[0]?.aborted).toBe(true);
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
  expect(gateFinishedAfterCleanup).toBe(true);
});

test("A Plus interruption aborts a stalled header request without retry", async () => {
  const entered = Promise.withResolvers<void>();
  let requests = 0;
  let aborted = false;
  globalThis.fetch = Object.assign(
    (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      requests++;
      const signal = init?.signal;
      if (!signal) throw new Error("Expected request cancellation signal");
      entered.resolve();
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(signal.reason);
          },
          { once: true },
        );
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const fiber = Effect.runFork(fetchAplusPage(APLUS_ROOT, gate));
  await entered.promise;
  await Effect.runPromise(Fiber.interrupt(fiber));
  expect(aborted).toBe(true);
  expect(requests).toBe(1);
});

test("A Plus cancels unread refused responses before returning the tagged error", async () => {
  const envelopes: ResponseInit[] = [
    { status: 302, headers: { "content-type": "text/html" } },
    { status: 206, headers: { "content-type": "text/html" } },
    {
      status: 200,
      headers: { "content-type": "text/html", "content-range": "bytes 0-2/9" },
    },
    { status: 200, headers: { "content-type": "application/json" } },
  ];
  for (const envelope of envelopes) {
    let cancelled = false;
    let requests = 0;
    const body = new ReadableStream<Uint8Array>({
      async cancel() {
        await Promise.resolve();
        cancelled = true;
      },
    });
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return new Response(body, envelope);
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(
      Effect.runPromise(fetchAplusPage(APLUS_ROOT, gate)),
    ).rejects.toThrow("Expected complete unredirected");
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
    expect(requests).toBe(1);
  }
});

test("A Plus preserves the refused response and its cancellation failure", async () => {
  const cleanupFailure = new Error("mock cleanup failure");
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      throw cleanupFailure;
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
    fetchAplusPage(APLUS_ROOT, gate).pipe(Effect.either),
  );
  expect(result._tag).toBe("Left");
  if (result._tag !== "Left") throw new Error("Expected refused response");
  expect(result.left.message).toContain(
    "complete unredirected Aplus HTTP200 text/html, received 302",
  );
  const failure = result.left.cause;
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError))
    throw new Error("Expected both response and cleanup failures");
  expect(failure.cause).toBeInstanceOf(Error);
  expect(failure.errors).toEqual([failure.cause, cleanupFailure]);
  expect(body.locked).toBe(false);
});
