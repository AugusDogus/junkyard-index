import { afterEach, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, TestClock, TestContext } from "effect";
import { fetchWeberbrothersPage } from "./weberbrothers-client";
import { streamWeberbrothersInventory } from "./weberbrothers-connector";
import type { ProviderRequestGate } from "./provider-http-client";
import { WEBERBROTHERS_CATALOG } from "./weberbrothers-yard-metadata";
import {
  findProviderCooldownError,
  PROVIDER_COOLDOWN_MS,
} from "./transient-request";

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

test("Weber stalled body deadline aborts its request and settles reader cleanup", async () => {
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
        fetchWeberbrothersPage(WEBERBROTHERS_CATALOG, direct),
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

test("Weber retries the transient HTTP 500 seen in production, then reads the donor page", async () => {
  const url =
    "https://www.weberbrothersauto.com/product/2016-hyundai-santa-fe-ta385/";
  let calls = 0;
  stub(async () => {
    calls++;
    return calls === 1
      ? new Response("error", { status: 500 })
      : new Response("<html>donor</html>", {
          headers: { "content-type": "text/html" },
        });
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(fetchWeberbrothersPage(url, direct));
      yield* Effect.promise(
        () => new Promise((resolve) => setTimeout(resolve, 5)),
      );
      yield* TestClock.adjust("2 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result).toBe("<html>donor</html>");
  expect(calls).toBe(2);
});

test("Weber does not retry a request deadline that would overrun its chunk", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    // The same rejection fetch produces when its deadline signal fires.
    throw new DOMException("The operation timed out.", "TimeoutError");
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        fetchWeberbrothersPage(WEBERBROTHERS_CATALOG, direct),
      );
      yield* Effect.promise(
        () => new Promise((resolve) => setTimeout(resolve, 5)),
      );
      yield* TestClock.adjust("10 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  expect(calls).toBe(1);
});

test("Weber denied response cancels its unread body exactly once without retry", async () => {
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
    Effect.either(fetchWeberbrothersPage(WEBERBROTHERS_CATALOG, direct)),
  );
  expect(result).toMatchObject({
    _tag: "Left",
    left: { message: expect.stringContaining("403") },
  });
  expect(calls).toBe(1);
  expect(cancellations).toBe(1);
  expect(response.body?.locked).toBe(false);
});

test("Weber interruption waits for pending fetch settlement before completing", async () => {
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
        fetchWeberbrothersPage(WEBERBROTHERS_CATALOG, direct),
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

test("Weber overlapping default invocations hold the shared gate through failed body cleanup and a two-second completed gap", async () => {
  let calls = 0;
  let cancellationStarted = false;
  let cancellationSettled = false;
  const options = {
    maxPages: 1,
    minimumUniqueInventory: 1,
    previousUniqueInventory: null,
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
          : new Response("missing", {
              status: 404,
              headers: { "content-type": "text/html" },
            });
      });
      const first = yield* Effect.fork(
        streamWeberbrothersInventory(options).pipe(Effect.either),
      );
      yield* Deferred.await(started);
      const second = yield* Effect.fork(
        streamWeberbrothersInventory(options).pipe(Effect.either),
      );
      yield* TestClock.adjust("3 seconds");
      expect(cancellationStarted).toBe(true);
      expect(cancellationSettled).toBe(false);
      expect(calls).toBe(1);
      yield* Deferred.succeed(settle, undefined);
      yield* Deferred.await(cleaned);
      yield* TestClock.adjust("1999 millis");
      expect(calls).toBe(1);
      yield* TestClock.adjust("1 millis");
      expect(calls).toBe(2);
      yield* TestClock.adjust("2 seconds");
      expect((yield* Fiber.join(first))._tag).toBe("Left");
      expect((yield* Fiber.join(second))._tag).toBe("Left");
      expect(response.body?.locked).toBe(false);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
});
test("Weber retries 5xx answers in-chunk, then hands the workflow a durable cooldown", async () => {
  let calls = 0;
  stub(async () => {
    calls++;
    return new Response("unavailable", { status: 502 });
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        fetchWeberbrothersPage(WEBERBROTHERS_CATALOG, direct),
      );
      for (const step of ["2 seconds", "4 seconds", "1 minute"] as const) {
        yield* Effect.promise(
          () => new Promise((resolve) => setTimeout(resolve, 5)),
        );
        yield* TestClock.adjust(step);
      }
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(calls).toBe(3);
  if (result._tag !== "Left") throw new Error("expected a cooldown");
  expect(findProviderCooldownError(result.left)?.retryAfterMs).toBe(
    PROVIDER_COOLDOWN_MS,
  );
});
