import { afterEach, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, TestClock, TestContext } from "effect";
import { fetchAlshnedPage } from "./alshned-client";
import { streamAlshnedInventory } from "./alshned-connector";
import type { ProviderRequestGate } from "./provider-http-client";
import { ALSHNED_CATALOG } from "./alshned-parser";

const originalFetch = globalThis.fetch;
const direct: ProviderRequestGate = (request) => request;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function stub(run: (options?: RequestInit) => Promise<Response>) {
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, options?: RequestInit) => run(options),
    { preconnect: originalFetch.preconnect },
  );
}

test("Alshned stalled body deadline aborts its request and settles reader cleanup", async () => {
  let canceled = false;
  let signal: AbortSignal | null | undefined;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        canceled = true;
      },
    }),
    { headers: { "content-type": "text/html" } },
  );
  stub(async (options) => {
    signal = options?.signal;
    return response;
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        fetchAlshnedPage(ALSHNED_CATALOG, direct),
      );
      yield* TestClock.adjust("25 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(canceled).toBe(true);
  expect(signal?.aborted).toBe(true);
  expect(response.body?.locked).toBe(false);
});

test("Alshned denied response cancels its unread body exactly once without retry", async () => {
  let calls = 0;
  let cancellations = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancellations++;
      },
    }),
    { status: 403, headers: { "content-type": "text/html" } },
  );
  stub(async () => {
    calls++;
    return response;
  });
  const result = await Effect.runPromise(
    Effect.either(fetchAlshnedPage(ALSHNED_CATALOG, direct)),
  );
  expect(result).toMatchObject({
    _tag: "Left",
    left: { message: expect.stringContaining("403") },
  });
  expect(calls).toBe(1);
  expect(cancellations).toBe(1);
  expect(response.body?.locked).toBe(false);
});

test("Alshned interruption waits for pending fetch settlement before completing", async () => {
  let aborted = false;
  let settled = false;
  let signal: AbortSignal | null | undefined;
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const abortStarted = yield* Deferred.make<void>();
      const settle = yield* Deferred.make<void>();
      stub((options) => {
        signal = options?.signal;
        Effect.runSync(Deferred.succeed(started, undefined));
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            Effect.runSync(Deferred.succeed(abortStarted, undefined));
          });
          void Effect.runPromise(Deferred.await(settle)).then(() => {
            settled = true;
            reject(new Error("mock transport settled after cancellation"));
          });
        });
      });
      const request = yield* Effect.fork(
        fetchAlshnedPage(ALSHNED_CATALOG, direct),
      );
      yield* Deferred.await(started);
      const interruption = yield* Effect.fork(Fiber.interrupt(request));
      yield* Deferred.await(abortStarted);
      expect(aborted).toBe(true);
      expect(settled).toBe(false);
      expect(yield* Fiber.poll(interruption)).toMatchObject({ _tag: "None" });
      yield* Deferred.succeed(settle, undefined);
      yield* Fiber.join(interruption);
      expect(settled).toBe(true);
      expect(signal?.aborted).toBe(true);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
});

test("Alshned overlapping default invocations hold the shared gate through failed body cleanup and a 2.5-second completed gap", async () => {
  let calls = 0;
  let cancellationStarted = false;
  let cancellationSettled = false;
  const options = {
    maxPages: 1,
    onBatch: () => Effect.void,
  };
  await Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const settle = yield* Deferred.make<void>();
      const cleaned = yield* Deferred.make<void>();
      const response = new Response(
        new ReadableStream<Uint8Array>({
          async cancel() {
            cancellationStarted = true;
            await Effect.runPromise(Deferred.await(settle));
            cancellationSettled = true;
            Effect.runSync(Deferred.succeed(cleaned, undefined));
          },
        }),
        { status: 403, headers: { "content-type": "text/html" } },
      );
      stub(async () => {
        calls++;
        Effect.runSync(Deferred.succeed(started, undefined));
        return calls === 1
          ? response
          : new Response("unavailable", {
              status: 503,
              headers: { "content-type": "text/html" },
            });
      });
      const first = yield* Effect.fork(
        streamAlshnedInventory(options).pipe(Effect.either),
      );
      yield* Deferred.await(started);
      const second = yield* Effect.fork(
        streamAlshnedInventory(options).pipe(Effect.either),
      );
      yield* TestClock.adjust("3 seconds");
      expect(cancellationStarted).toBe(true);
      expect(cancellationSettled).toBe(false);
      expect(calls).toBe(1);
      yield* Deferred.succeed(settle, undefined);
      yield* Deferred.await(cleaned);
      yield* TestClock.adjust("2499 millis");
      expect(calls).toBe(1);
      yield* TestClock.adjust("1 millis");
      expect(calls).toBe(2);
      yield* TestClock.adjust("2500 millis");
      expect((yield* Fiber.join(first))._tag).toBe("Left");
      expect((yield* Fiber.join(second))._tag).toBe("Left");
      expect(response.body?.locked).toBe(false);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
});
