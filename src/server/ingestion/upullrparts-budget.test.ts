import { afterEach, expect, test } from "bun:test";
import { Cause, Effect, Fiber, Option, TestClock, TestContext } from "effect";
import fixture from "./fixtures/upullrparts-vehicle.json";
import { streamUpullRPartsInventoryWithRequestGate } from "./upullrparts-connector";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("allows a complete make fallback when provider responses take 2.2 seconds", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      const params = new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      );
      if (params.get("apiAction") === "getMakes")
        return Response.json([
          "Ford",
          ...Array.from({ length: 55 }, (_, i) => `Make-${i}`),
        ]);
      if (params.get("apiAction") === "getModels")
        return Response.json(params.get("Make") === "Ford" ? ["FOCUS"] : []);
      if (params.has("makes")) return Response.json([]);
      return Response.json([
        fixture,
        { ...fixture, Store: 2, VIN: "VIN-2" },
        { ...fixture, Store: 3, VIN: "VIN-3" },
      ]);
    },
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        streamUpullRPartsInventoryWithRequestGate(
          { onBatch: () => Effect.void },
          (request) =>
            Effect.sleep("2200 millis").pipe(Effect.zipRight(request)),
        ),
      );
      yield* TestClock.adjust("5 minutes");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result).toMatchObject({
    status: "complete",
    count: 3,
    errors: [],
    warnings: [],
  });
  expect(requests).toBe(114);
});

test("bounds a stalled catalog to ten minutes without emitting batches", async () => {
  let batches = 0;
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        streamUpullRPartsInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                batches++;
              }),
          },
          () => Effect.never,
        ),
      );
      yield* TestClock.adjust("9 minutes");
      expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
      yield* TestClock.adjust("1 minute");
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(exit._tag).toBe("Failure");
  if (exit._tag === "Failure")
    expect(Cause.pretty(exit.cause)).toContain("ten-minute checkpoint budget");
  expect(batches).toBe(0);
});
