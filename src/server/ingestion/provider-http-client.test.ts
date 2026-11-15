import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Fiber, Random, Schema, TestClock, TestContext } from "effect";
import { RetryableHttpStatusError } from "./errors";
import {
  fetchProviderJson,
  fetchProviderResponse,
} from "./provider-http-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function respondWith(body: string): void {
  globalThis.fetch = Object.assign(
    async () => new Response(body, { status: 200 }),
    { preconnect: originalFetch.preconnect },
  );
}

function respondWithStatuses(
  statuses: readonly number[],
  retryAfter: string | null,
): () => number {
  let attempts = 0;
  globalThis.fetch = Object.assign(
    async () =>
      new Response(null, {
        status: statuses[attempts++] ?? 200,
        headers: retryAfter === null ? {} : { "Retry-After": retryAfter },
      }),
    { preconnect: originalFetch.preconnect },
  );
  return () => attempts;
}

const testTime = Date.UTC(2026, 10, 13, 12);

describe("provider HTTP retries", () => {
  test.each([
    { status: 429, retryAfter: "60", jitter: false },
    {
      status: 503,
      retryAfter: "Fri, 13 Nov 2026 12:01:00 GMT",
      jitter: false,
    },
    {
      status: 429,
      retryAfter: "Friday, 13-Nov-26 12:01:00 GMT",
      jitter: false,
    },
    { status: 429, retryAfter: "Fri Nov 13 12:01:00 2026", jitter: false },
    { status: 429, retryAfter: "60", jitter: true },
  ])("respects Retry-After and request hooks: %j", async (policy) => {
    const attempts = respondWithStatuses(
      [policy.status, 200],
      policy.retryAfter,
    );
    let gatedAttempts = 0;
    const responses: number[] = [];

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(testTime);
        const fiber = yield* Effect.fork(
          fetchProviderResponse({
            url: "https://provider.example/inventory",
            context: "Example inventory",
            retry: { retryLimit: 1, jitter: policy.jitter },
            requestGate: (request) =>
              Effect.sync(() => {
                gatedAttempts++;
              }).pipe(Effect.zipRight(request)),
            onResponse: (response) => {
              responses.push(response.status);
            },
          }),
        );
        yield* TestClock.adjust("59999 millis");
        expect(attempts()).toBe(1);
        expect(gatedAttempts).toBe(1);
        expect(responses).toEqual([policy.status]);
        yield* TestClock.adjust("1 millis");
        return yield* Fiber.join(fiber);
      }).pipe(
        Effect.withRandom(Random.fixed([0])),
        Effect.provide(TestContext.TestContext),
      ),
    );

    expect(response.status).toBe(200);
    expect(attempts()).toBe(2);
    expect(gatedAttempts).toBe(2);
    expect(responses).toEqual([policy.status, 200]);
  });

  test.each([
    null,
    "",
    "invalid",
    "-60",
    "1.5",
    "1e3",
    "Infinity",
    "NaN",
    "2027-11-13",
    "Fri, 13 Nov 2026 12:01:00 PST",
    "Fri, 99 Nov 2026 12:01:00 GMT",
    "Tue, 30 Feb 2027 12:01:00 GMT",
    "Fri, 13 Nov 2026 11:59:00 GMT",
    "0",
    "1",
  ])("preserves exponential backoff for Retry-After %j", async (retryAfter) => {
    const attempts = respondWithStatuses([429, 503, 200], retryAfter);

    const response = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(testTime);
        const fiber = yield* Effect.fork(
          fetchProviderResponse({
            url: "https://provider.example/inventory",
            context: "Example inventory",
            retry: { retryLimit: 2, jitter: false },
          }),
        );
        yield* TestClock.adjust("999 millis");
        expect(attempts()).toBe(1);
        yield* TestClock.adjust("1 millis");
        expect(attempts()).toBe(2);
        yield* TestClock.adjust("1999 millis");
        expect(attempts()).toBe(2);
        yield* TestClock.adjust("1 millis");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(response.status).toBe(200);
    expect(attempts()).toBe(3);
  });

  test.each([0, 2])("retains the retry limit of %i", async (retryLimit) => {
    const attempts = respondWithStatuses([429, 429, 429], "2");
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          Effect.either(
            fetchProviderResponse({
              url: "https://provider.example/inventory",
              context: "Example inventory",
              retry: { retryLimit, jitter: false },
            }),
          ),
        );
        yield* TestClock.adjust("4 seconds");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(attempts()).toBe(retryLimit + 1);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(RetryableHttpStatusError);
      expect(result.left).toMatchObject({ status: 429, retryAfterMs: 2_000 });
    }
  });

  test("does not retry HTTP 403 with Retry-After", async () => {
    const attempts = respondWithStatuses([403], "60");
    const response = await Effect.runPromise(
      fetchProviderResponse({
        url: "https://provider.example/inventory",
        context: "Example inventory",
      }),
    );

    expect(response.status).toBe(403);
    expect(attempts()).toBe(1);
  });

  test.each([
    {
      retryAfter: "Wednesday, 13-Nov-75 12:01:00 GMT",
      retryAt: Date.UTC(2075, 10, 13, 12, 1),
    },
    {
      retryAfter: "Friday, 13-Nov-76 12:01:00 GMT",
      retryAt: Date.UTC(1976, 10, 13, 12, 1),
    },
  ])("interprets RFC850 years relative to the clock: %j", async (example) => {
    respondWithStatuses([429], example.retryAfter);
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(testTime);
        return yield* Effect.either(
          fetchProviderResponse({
            url: "https://provider.example/inventory",
            context: "Example inventory",
            retry: { retryLimit: 0 },
          }),
        );
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toMatchObject({
        retryAfterMs: Math.max(0, example.retryAt - testTime),
      });
    }
  });

  test("finite waits beyond the live-clock timer limit eventually retry", async () => {
    const attempts = respondWithStatuses([429, 200], "2592000");
    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          fetchProviderResponse({
            url: "https://provider.example/inventory",
            context: "Example inventory",
            retry: { retryLimit: 1, jitter: false },
          }),
        );
        yield* TestClock.adjust("1 millis");
        expect([...(yield* TestClock.sleeps())]).toEqual([2 ** 31 - 1]);
        yield* TestClock.adjust("2591999998 millis");
        expect(attempts()).toBe(1);
        yield* TestClock.adjust("1 millis");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(response.status).toBe(200);
    expect(attempts()).toBe(2);
  });

  test.each([
    { description: "finite", retryAfter: "2592000" },
    { description: "overflowing", retryAfter: "9".repeat(400) },
  ])(
    "$description advertised waits remain interruptible without early retries",
    async ({ retryAfter }) => {
      const attempts = respondWithStatuses([429, 200], retryAfter);
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            fetchProviderResponse({
              url: "https://provider.example/inventory",
              context: "Example inventory",
              retry: { retryLimit: 1 },
            }),
          );
          yield* TestClock.adjust("29 days");
          expect(attempts()).toBe(1);
          const exit = yield* Fiber.interrupt(fiber);
          expect(exit._tag).toBe("Failure");
          yield* TestClock.adjust("2 days");
          expect(attempts()).toBe(1);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    },
  );

  test("keeps jitter on ordinary backoff", async () => {
    const attempts = respondWithStatuses([429, 200], null);
    const response = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          fetchProviderResponse({
            url: "https://provider.example/inventory",
            context: "Example inventory",
            retry: { retryLimit: 1 },
          }),
        );
        // Effect's minimum jitter multiplier is 0.8 when Random.next is zero.
        yield* TestClock.adjust("799 millis");
        expect(attempts()).toBe(1);
        yield* TestClock.adjust("1 millis");
        return yield* Fiber.join(fiber);
      }).pipe(
        Effect.withRandom(Random.fixed([0])),
        Effect.provide(TestContext.TestContext),
      ),
    );
    expect(response.status).toBe(200);
    expect(attempts()).toBe(2);
  });
});

describe("provider HTTP JSON decoding", () => {
  test("parses and validates a provider response at the transport boundary", async () => {
    respondWith('{"page":3}');

    const result = await Effect.runPromise(
      fetchProviderJson({
        url: "https://provider.example/inventory",
        context: "Example inventory",
        schema: Schema.Struct({ page: Schema.Int }),
      }),
    );

    expect(result).toEqual({ page: 3 });
  });

  test("identifies invalid JSON with provider context", async () => {
    respondWith("not-json");

    await expect(
      Effect.runPromise(
        fetchProviderJson({
          url: "https://provider.example/inventory",
          context: "Example inventory",
          schema: Schema.Struct({ page: Schema.Int }),
        }),
      ),
    ).rejects.toThrow("Example inventory returned invalid JSON");
  });

  test("identifies schema-invalid data with provider context", async () => {
    respondWith('{"page":"three"}');

    await expect(
      Effect.runPromise(
        fetchProviderJson({
          url: "https://provider.example/inventory",
          context: "Example inventory",
          schema: Schema.Struct({ page: Schema.Int }),
        }),
      ),
    ).rejects.toThrow("Example inventory returned invalid data");
  });
});

describe("provider HTTP redirect policy", () => {
  test.each(["manual", "error"] as const)(
    "%s prevents a request to the redirect destination",
    async (redirect) => {
      const paths: string[] = [];
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const path = new URL(request.url).pathname;
          paths.push(path);
          return path === "/inventory"
            ? Response.redirect(new URL("/other-yard", request.url), 302)
            : new Response("Foreign inventory");
        },
      });
      try {
        const result = await Effect.runPromise(
          fetchProviderResponse({
            url: new URL("/inventory", server.url).href,
            context: "Owned public inventory",
            redirect,
            retry: { retryLimit: 0 },
          }).pipe(Effect.either),
        );
        expect(paths).toEqual(["/inventory"]);
        if (redirect === "manual") {
          expect(result._tag).toBe("Right");
          if (result._tag === "Right") {
            expect(result.right.status).toBe(302);
            await result.right.body?.cancel();
          }
        } else {
          expect(result._tag).toBe("Left");
        }
      } finally {
        await server.stop(true);
      }
    },
  );
});
