import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import {
  fetchPullapartVehicleExtendedInfo,
  type PullapartRequestGate,
} from "./pullapart-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Pull-A-Part request policy", () => {
  test("applies the request gate to every retry attempt", async () => {
    let fetchAttempts = 0;
    let gatedAttempts = 0;
    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        fetchAttempts += 1;
        return new Response(null, {
          status: fetchAttempts === 1 ? 429 : 404,
        });
      },
      { preconnect: originalFetch.preconnect },
    );

    const requestGate: PullapartRequestGate = (request) =>
      Effect.sync(() => {
        gatedAttempts += 1;
      }).pipe(Effect.zipRight(request));

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const requestFiber = yield* fetchPullapartVehicleExtendedInfo(
          { locationId: 3, ticketId: 1191613, lineId: 12 },
          requestGate,
        ).pipe(Effect.fork);
        yield* TestClock.adjust("2 minutes");
        return yield* Fiber.join(requestFiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );

    expect(result).toBeNull();
    expect(fetchAttempts).toBe(2);
    expect(gatedAttempts).toBe(2);
  });
});
