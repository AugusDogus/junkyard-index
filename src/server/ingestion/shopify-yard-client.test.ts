import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import { shopifyRetryAfter, shopifyYardReader } from "./shopify-yard-client";
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
        (await Effect.runPromise(Effect.either(read(target, (r) => r))))._tag,
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
    expect(await Effect.runPromise(reader()(url, (r) => r))).toBe(
      "complete html",
    );
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
        (await Effect.runPromise(Effect.either(reader()(url, (r) => r))))._tag,
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
  test("does not return a rate-limit failure before Retry-After elapses", async () => {
    respond(
      async () =>
        new Response("limited", {
          status: 429,
          headers: { "Retry-After": "60" },
        }),
    );
    let completed = false;
    await Effect.runPromise(
      Effect.gen(function* () {
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
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });
  test("parses Retry-After seconds and HTTP dates with a conservative missing-header fallback", () => {
    const now = Date.UTC(2026, 10, 15, 12);
    expect(shopifyRetryAfter("60", now)).toBe(60000);
    expect(shopifyRetryAfter("Sun, 15 Nov 2026 12:02:00 GMT", now)).toBe(
      120000,
    );
    expect(shopifyRetryAfter("Sun, 15 Nov 2026 11:59:00 GMT", now)).toBe(0);
    expect(shopifyRetryAfter(null, now)).toBe(60000);
    expect(shopifyRetryAfter("invalid", now)).toBe(60000);
  });
});
