import { afterEach, expect, test } from "bun:test";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import { fetchAplusPage } from "./aplus-client";
import { parseAplusModel } from "./aplus-parser";
import {
  aplusFixtureMake,
  aplusFixtureModel,
  aplusFixtureModelPage,
  aplusFixtureRecord,
} from "./aplus-test-fixtures";
import { APLUS_ORIGIN, APLUS_ROOT } from "./aplus-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const modelUrl = APLUS_ORIGIN + aplusFixtureModel.path;
const modelPage = aplusFixtureModelPage([aplusFixtureRecord(1)]);
/** Lets real fetch promises settle while the TestClock owns Effect time. */
const until = (ready: () => boolean) =>
  Effect.gen(function* () {
    for (let turn = 0; !ready(); turn++) {
      if (turn > 1000) return yield* Effect.die("Mock request never arrived");
      yield* Effect.promise(() => new Promise((r) => setTimeout(r, 1)));
    }
  });
/** A dynamic origin response that never sends headers until aborted, like the
 * production model pages that exceeded the request deadline. */
const stall = (signal: AbortSignal | null | undefined) =>
  new Promise<Response>((_resolve, reject) => {
    if (!signal) throw new Error("Expected request cancellation signal");
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html" } });

test("A Plus retries a model page that stalls past its deadline and accepts the next complete response", async () => {
  const signals: AbortSignal[] = [];
  globalThis.fetch = Object.assign(
    (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return signals.length === 1
        ? stall(init?.signal)
        : Promise.resolve(html(modelPage));
    },
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(fetchAplusPage(modelUrl, gate));
      yield* until(() => signals.length === 1);
      // The production timeouts were 20 second deadlines on pages whose
      // measured baseline is 2 to 7 seconds. A slow page within 40 seconds
      // must still be accepted on the first attempt.
      yield* TestClock.adjust("39 seconds");
      expect(signals[0]?.aborted).toBe(false);
      yield* TestClock.adjust("1 second");
      yield* until(() => signals[0]?.aborted === true);
      yield* TestClock.adjust("4 seconds");
      yield* until(() => signals.length === 2);
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Right");
  if (result._tag !== "Right") throw new Error("Expected retried page");
  expect(
    parseAplusModel(result.right, aplusFixtureMake, aplusFixtureModel).records,
  ).toEqual([aplusFixtureRecord(1)]);
  expect(signals).toHaveLength(2);
});

test("A Plus retries the exact production deadline rejection", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      if (requests === 1)
        throw new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        );
      return html(modelPage);
    },
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(fetchAplusPage(modelUrl, gate));
      yield* until(() => requests === 1);
      yield* TestClock.adjust("4 seconds");
      yield* until(() => requests === 2);
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Right");
  expect(requests).toBe(2);
});

test("A Plus bounds stalled-page retries and fails the chunk without a partial checkpoint", async () => {
  const signals: AbortSignal[] = [];
  globalThis.fetch = Object.assign(
    (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      return stall(init?.signal);
    },
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(fetchAplusPage(modelUrl, gate));
      for (const [attempt, backoff] of [
        [1, "4 seconds"],
        [2, "8 seconds"],
      ] as const) {
        yield* until(() => signals.length === attempt);
        yield* TestClock.adjust("40 seconds");
        yield* until(() => signals[attempt - 1]?.aborted === true);
        yield* TestClock.adjust(backoff);
      }
      yield* until(() => signals.length === 3);
      yield* TestClock.adjust("40 seconds");
      // A fourth attempt would need this time and must never start.
      yield* TestClock.adjust("60 seconds");
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Left");
  if (result._tag !== "Left") throw new Error("Expected exhausted retries");
  expect(result.left._tag).toBe("AplusProviderError");
  expect(result.left.message).toContain("No advanced checkpoint was accepted");
  expect(signals).toHaveLength(3);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

test("A Plus never retries block, refusal or origin error statuses", async () => {
  for (const status of [403, 429, 404, 503, 524]) {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return html("blocked", status);
      },
      { preconnect: originalFetch.preconnect },
    );
    const result = await Effect.runPromise(
      Effect.either(fetchAplusPage(modelUrl, gate)),
    );
    expect(result._tag).toBe("Left");
    expect(requests).toBe(1);
  }
});

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
