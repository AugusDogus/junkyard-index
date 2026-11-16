import { afterEach, describe, expect, test } from "bun:test";
import { Clock, Effect, Fiber, TestClock, TestContext } from "effect";
import {
  ShopifyYardProviderError,
  shopifyRetryAfter,
  shopifyYardReader,
} from "./shopify-yard-client";
import { streamHawaiipartsInventory } from "./hawaiiparts-connector";
import { HAWAIIPARTS_CATALOG } from "./hawaiiparts-yard-metadata";
import { shopifyYardFixture } from "./shopify-yard-test-fixtures";
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const url = "https://aloha.parts/pages/yard";
const reader = () =>
  shopifyYardReader("hawaiiparts", new Map([[url, "text/html"]]));
function respond(run: () => Promise<Response>) {
  globalThis.fetch = Object.assign(run, {
    preconnect: originalFetch.preconnect,
  });
}
describe("Shopify yard owned HTTP", () => {
  test("refuses foreign, credentialed, paged and redirected destinations before fetching", async () => {
    let calls = 0;
    respond(async () => {
      calls++;
      return new Response("", { headers: { "Content-Type": "text/html" } });
    });
    const read = reader();
    for (const target of [
      url + "?page=2",
      url + "#car-a",
      "https://evil.example/",
      "https://user:pass@aloha.parts/pages/yard",
    ])
      expect(
        (
          await Effect.runPromise(
            Effect.either(read(target, { requestGate: (r) => r })),
          )
        )._tag,
      ).toBe("Left");
    expect(calls).toBe(0);
  });
  test("reads a complete owned body with HTML headers", async () => {
    respond(
      async () =>
        new Response("complete html", {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
    );
    expect(
      await Effect.runPromise(reader()(url, { requestGate: (r) => r })),
    ).toBe("complete html");
  });
  test("rejects partial responses, redirects, wrong types and HTTP errors, without retries", async () => {
    for (const [status, headers] of [
      [206, { "Content-Type": "text/html", "Content-Range": "bytes 0-10/30" }],
      [302, { Location: "https://evil.example/" }],
      [200, { "Content-Type": "application/json" }],
      [429, { "Retry-After": "60" }],
    ] as const) {
      let calls = 0;
      respond(async () => {
        calls++;
        return new Response("failed", { status, headers });
      });
      expect(
        (
          await Effect.runPromise(
            Effect.either(reader()(url, { requestGate: (r) => r })),
          )
        )._tag,
      ).toBe("Left");
      expect(calls).toBe(1);
    }
  });
  test("holds a serial request gate through the body and completion gap", async () => {
    let calls = 0;
    let finishBody: (() => void) | undefined;
    respond(async () => {
      calls++;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            finishBody = () => {
              controller.enqueue(new TextEncoder().encode("html"));
              controller.close();
            };
          },
        }),
        { headers: { "Content-Type": "text/html" } },
      );
    });
    const read = reader();
    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* Effect.fork(read(url));
        const second = yield* Effect.fork(read(url));
        yield* Effect.yieldNow();
        expect(calls).toBe(1);
        if (!finishBody) throw new Error("No first body reader");
        finishBody();
        yield* TestClock.adjust("11 seconds");
        expect(calls).toBe(1);
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(first);
        expect(calls).toBe(2);
        if (!finishBody) throw new Error("No second body reader");
        finishBody();
        yield* TestClock.adjust("12 seconds");
        yield* Fiber.join(second);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });
  test.each(["60", "Sun, 15 Nov 2026 12:01:00 GMT"])(
    "waits within the budget for Retry-After %s",
    async (header) => {
      const now = Date.UTC(2026, 10, 15, 12);
      respond(
        async () =>
          new Response("limited", {
            status: 429,
            headers: { "Retry-After": header },
          }),
      );
      let completed = false;
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* TestClock.setTime(now);
          const fiber = yield* Effect.fork(
            Effect.either(reader()(url)).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  completed = true;
                }),
              ),
            ),
          );
          yield* TestClock.adjust("59 seconds");
          expect(completed).toBe(false);
          yield* TestClock.adjust("1 second");
          const result = yield* Fiber.join(fiber);
          expect(result._tag).toBe("Left");
          if (result._tag === "Left")
            expect(result.left.retryAt).toBe(now + 60_000);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    },
  );
  test("parses Retry-After seconds and HTTP dates with a conservative missing-header fallback", () => {
    const now = Date.UTC(2026, 10, 15, 12);
    expect(shopifyRetryAfter("60", now)).toBe(60000);
    expect(shopifyRetryAfter("Sun, 15 Nov 2026 12:02:00 GMT", now)).toBe(
      120000,
    );
    expect(shopifyRetryAfter("Sun, 15 Nov 2026 11:59:00 GMT", now)).toBe(0);
    expect(shopifyRetryAfter(null, now)).toBe(60000);
    expect(shopifyRetryAfter("invalid", now)).toBe(60000);
    expect(shopifyRetryAfter("9".repeat(400), now)).toBe(86_400_000);
    expect(shopifyRetryAfter("Sun, 15 Nov 2099 12:02:00 GMT", now)).toBe(
      86_400_000,
    );
  });
  test.each([
    ["seconds", "3600", 3_600_000],
    ["HTTP date", "Sun, 15 Nov 2026 13:00:00 GMT", 3_600_000],
    ["far-future HTTP date", "Sun, 15 Nov 2099 13:00:00 GMT", 86_400_000],
    ["huge seconds", "9999999999999999999999", 86_400_000],
    ["overflowing seconds", "9".repeat(400), 86_400_000],
  ] as const)(
    "returns a typed retry time without sleeping beyond the chunk for %s",
    async (_name, header, delay) => {
      const now = Date.UTC(2026, 10, 15, 12);
      let calls = 0;
      respond(async () => {
        calls++;
        return new Response("limited", {
          status: 429,
          headers: { "Retry-After": header },
        });
      });
      const read = reader();
      await Effect.runPromise(
        Effect.gen(function* () {
          yield* TestClock.setTime(now);
          const first = yield* Effect.fork(Effect.either(read(url)));
          yield* TestClock.adjust("1 second");
          expect((yield* Fiber.poll(first))._tag).toBe("Some");
          const result = yield* Fiber.join(first);
          if (result._tag !== "Left")
            throw new Error("Expected rate-limit failure");
          expect(result.left).toBeInstanceOf(ShopifyYardProviderError);
          expect(result.left.retryAt).toBe(now + delay);
          expect(result.left.message).toContain(
            new Date(now + delay).toISOString(),
          );
          expect(result.left.message).toContain("Prior inventory is preserved");
          expect(yield* Clock.currentTimeMillis).toBe(now + 1000);
          // The same process must not fetch again while its provider pause is active.
          const repeated = yield* Effect.either(read(url));
          expect(repeated._tag).toBe("Left");
          expect(calls).toBe(1);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    },
  );
  test("interrupts a short provider pause without waiting in a finalizer", async () => {
    respond(
      async () =>
        new Response("limited", {
          status: 503,
          headers: { "Retry-After": "60" },
        }),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          Effect.either(
            reader()(url).pipe(
              Effect.timeoutFail({
                duration: "1 second",
                onTimeout: () => new Error("cancelled"),
              }),
            ),
          ),
        );
        yield* TestClock.adjust("1 second");
        expect((yield* Fiber.poll(fiber))._tag).toBe("Some");
        const result = yield* Fiber.join(fiber);
        if (result._tag !== "Left") throw new Error("Expected interruption");
        expect(result.left.message).toBe("cancelled");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });
  test("uses the remaining chunk budget after earlier pages and emits no partial inventory", async () => {
    const now = Date.UTC(2026, 10, 15, 12);
    let emitted = false;
    let pages = 0;
    let requests = 0;
    respond(async () => {
      requests++;
      return new Response("limited", {
        status: 429,
        headers: { "Retry-After": "90" },
      });
    });
    const read = shopifyYardReader(
      "hawaiiparts",
      new Map([[HAWAIIPARTS_CATALOG, "text/html"]]),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(now);
        const fiber = yield* Effect.fork(
          Effect.either(
            streamHawaiipartsInventory({
              previousUniqueInventory: null,
              readPage: (target, options) => {
                pages++;
                return pages === 1
                  ? Effect.sleep("2 minutes").pipe(
                      Effect.as(shopifyYardFixture("hawaiiparts-home")),
                    )
                  : read(target, options);
              },
              onBatch: () =>
                Effect.sync(() => {
                  emitted = true;
                }),
            }),
          ),
        );
        yield* TestClock.adjust("2 minutes");
        expect((yield* Fiber.poll(fiber))._tag).toBe("Some");
        const result = yield* Fiber.join(fiber);
        if (result._tag !== "Left")
          throw new Error("Expected rate-limit failure");
        expect(result.left.retryAt).toBe(now + 210_000);
        expect(emitted).toBe(false);
        expect(requests).toBe(1);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });
});
