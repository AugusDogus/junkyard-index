import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Deferred, Effect, Fiber, TestClock, TestContext } from "effect";
import {
  fetchHagermanPage,
  HAGERMAN_MAX_RESPONSE_BYTES,
} from "./hagerman-client";
import { HAGERMAN_CATALOG_URL } from "./hagerman-parser";
import type { ProviderRequestGate } from "./provider-http-client";
import { streamHagermanInventory } from "./hagerman-connector";
import { hagermanFixture } from "./hagerman-test-fixtures";

const gate: ProviderRequestGate = (request) => request;
let restore = () => {};
afterEach(() => restore());
function respond(response: () => Response) {
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        _url: Parameters<typeof fetch>[0],
        options?: Parameters<typeof fetch>[1],
      ) => {
        expect(options?.redirect).toBe("manual");
        return response();
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  restore = () => mock.mockRestore();
  return mock;
}

describe("Hagerman complete-body HTTP boundary", () => {
  test.each([302, 403, 429, 502])(
    "HTTP %s stops after one manual request without retry",
    async (status) => {
      const mock = respond(
        () =>
          new Response("original source stop", {
            status,
            headers: {
              "content-type": "text/html",
              "retry-after": "60",
              location: "https://foreign.example/",
            },
          }),
      );
      const result = await Effect.runPromise(
        Effect.either(fetchHagermanPage(HAGERMAN_CATALOG_URL, gate)),
      );
      expect(result._tag).toBe("Left");
      expect(mock).toHaveBeenCalledTimes(1);
    },
  );
  test("foreign destinations fail before the request gate or fetch", async () => {
    const mock = respond(() => new Response("unreachable"));
    let gated = 0;
    const result = await Effect.runPromise(
      Effect.either(
        fetchHagermanPage(
          "https://hagermanparts.com/shop/?part_type=9000",
          (request) => {
            gated++;
            return request;
          },
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(mock).not.toHaveBeenCalled();
    expect(gated).toBe(0);
  });
  test.each([
    "range",
    "pagination",
    "mime",
    "length",
    "utf8",
    "size",
    "stream",
  ])("invalid %s body fails closed", async (kind) => {
    const mock = respond(() => {
      const headers = new Headers({ "content-type": "text/html" });
      if (kind === "range") headers.set("content-range", "bytes 0-2/4");
      if (kind === "pagination")
        headers.set("link", '</shop/?page_number=2>; rel="next"');
      if (kind === "mime") headers.set("content-type", "application/json");
      if (kind === "length") headers.set("content-length", "500");
      if (kind === "utf8")
        return new Response(Uint8Array.of(0xc0), { headers });
      if (kind === "size")
        return new Response("x".repeat(HAGERMAN_MAX_RESPONSE_BYTES + 1), {
          headers,
        });
      if (kind === "stream")
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error("read failed"));
            },
          }),
          { headers },
        );
      return new Response("<html></html>", { headers });
    });
    const result = await Effect.runPromise(
      Effect.either(fetchHagermanPage(HAGERMAN_CATALOG_URL, gate)),
    );
    expect(result._tag).toBe("Left");
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("Hagerman shared production request gate", () => {
  const options = { maxPages: 1, onBatch: () => Effect.void };

  test("concurrent chunks wait for a long complete body and the completed 2.5-second gap", async () => {
    let calls = 0;
    let finishBody = () => {};
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(hagermanFixture("contact")),
            );
            finishBody = () => controller.close();
          },
        });
        const mock = respond(() => {
          calls++;
          Effect.runSync(Deferred.succeed(started, undefined));
          return new Response(calls === 1 ? body : hagermanFixture("contact"), {
            headers: { "content-type": "text/html" },
          });
        });
        const first = yield* Effect.fork(streamHagermanInventory(options));
        yield* Deferred.await(started);
        const second = yield* Effect.fork(streamHagermanInventory(options));
        yield* TestClock.adjust("4 seconds");
        expect(calls).toBe(1);
        finishBody();
        yield* TestClock.adjust("2499 millis");
        expect(calls).toBe(1);
        yield* TestClock.adjust("1 millis");
        expect(calls).toBe(2);
        yield* TestClock.adjust("2500 millis");
        expect((yield* Fiber.join(first)).status).toBe("paused");
        expect((yield* Fiber.join(second)).status).toBe("paused");
        expect(body.locked).toBe(false);
        expect(mock).toHaveBeenCalledTimes(2);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });

  test("failed requests retain the shared permit through unread-body cleanup and the full gap", async () => {
    let calls = 0;
    let cleanupStarted = false;
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const releaseCleanup = yield* Deferred.make<void>();
        const cleaned = yield* Deferred.make<void>();
        const body = new ReadableStream<Uint8Array>({
          async cancel() {
            cleanupStarted = true;
            await Effect.runPromise(Deferred.await(releaseCleanup));
            Effect.runSync(Deferred.succeed(cleaned, undefined));
          },
        });
        respond(() => {
          calls++;
          Effect.runSync(Deferred.succeed(started, undefined));
          return new Response(calls === 1 ? body : "source unavailable", {
            status: 403,
            headers: { "content-type": "text/html" },
          });
        });
        const first = yield* Effect.fork(
          streamHagermanInventory(options).pipe(Effect.either),
        );
        yield* Deferred.await(started);
        const second = yield* Effect.fork(
          streamHagermanInventory(options).pipe(Effect.either),
        );
        yield* TestClock.adjust("4 seconds");
        expect(cleanupStarted).toBe(true);
        expect(calls).toBe(1);
        yield* Deferred.succeed(releaseCleanup, undefined);
        yield* Deferred.await(cleaned);
        yield* TestClock.adjust("2499 millis");
        expect(calls).toBe(1);
        yield* TestClock.adjust("1 millis");
        expect(calls).toBe(2);
        yield* TestClock.adjust("2500 millis");
        expect((yield* Fiber.join(first))._tag).toBe("Left");
        expect((yield* Fiber.join(second))._tag).toBe("Left");
        expect(body.locked).toBe(false);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });

  test("a timed-out transport settles after abort before another chunk can enter or its gap begins", async () => {
    let calls = 0;
    let aborted = false;
    await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        const abortStarted = yield* Deferred.make<void>();
        const releaseTransport = yield* Deferred.make<void>();
        const settled = yield* Deferred.make<void>();
        const mock = spyOn(globalThis, "fetch").mockImplementation(
          Object.assign(
            async (
              _url: Parameters<typeof fetch>[0],
              request?: Parameters<typeof fetch>[1],
            ) => {
              calls++;
              expect(request?.redirect).toBe("manual");
              if (calls !== 1)
                return new Response("source denied", {
                  status: 403,
                  headers: { "content-type": "text/html" },
                });
              const signal = request?.signal;
              if (!signal)
                throw new Error("Mock expected the native abort signal");
              signal.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  Effect.runSync(Deferred.succeed(abortStarted, undefined));
                },
                { once: true },
              );
              Effect.runSync(Deferred.succeed(started, undefined));
              await Effect.runPromise(Deferred.await(releaseTransport));
              Effect.runSync(Deferred.succeed(settled, undefined));
              throw new Error("Mock transport settled after cancellation");
            },
            { preconnect: globalThis.fetch.preconnect },
          ),
        );
        restore = () => mock.mockRestore();
        const first = yield* Effect.fork(
          streamHagermanInventory(options).pipe(Effect.either),
        );
        yield* Deferred.await(started);
        const second = yield* Effect.fork(
          streamHagermanInventory(options).pipe(Effect.either),
        );
        yield* TestClock.adjust("21 seconds");
        yield* Deferred.await(abortStarted);
        expect(aborted).toBe(true);
        expect(calls).toBe(1);
        expect(yield* Fiber.poll(first)).toMatchObject({ _tag: "None" });
        yield* Deferred.succeed(releaseTransport, undefined);
        yield* Deferred.await(settled);
        yield* TestClock.adjust("2499 millis");
        expect(calls).toBe(1);
        yield* TestClock.adjust("1 millis");
        expect(calls).toBe(2);
        yield* TestClock.adjust("2500 millis");
        expect((yield* Fiber.join(first))._tag).toBe("Left");
        expect((yield* Fiber.join(second))._tag).toBe("Left");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
  });
});
