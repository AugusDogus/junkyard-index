import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import {
  decodeHollanderstoresBatch,
  fetchHollanderstoresPage,
  HOLLANDERSTORES_VPIC_URL,
  HollanderstoresProviderError,
} from "./hollanderstores-client";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import {
  cachedHollanderstoresMakes,
  loadHollanderstoresMakes,
  type HollanderstoresMakeCache,
} from "./hollanderstores-make-cache";

let fetchMock: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => fetchMock?.mockRestore());
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const vin = "1HGCM82633A004352";

test("posts exactly the native card form and accepts a complete response", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe(
          "https://leblancsauto.hollanderstores.com/VehicleDealerSearch",
        );
        expect(init?.method).toBe("POST");
        expect(init?.redirect).toBe("manual");
        expect(String(init?.body)).toBe("hdnChangeDisplay=card");
        return new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const yard = HOLLANDERSTORES_YARDS[0];
  expect(await Effect.runPromise(fetchHollanderstoresPage(yard, gate))).toBe(
    "<html></html>",
  );
});
test("vPIC is mocked, identity joined and bounded to 50 unique valid VINs", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        expect(String(url)).toBe(HOLLANDERSTORES_VPIC_URL);
        expect(String(init?.body)).toBe(`format=json&data=${vin}`);
        return Response.json({
          Count: 1,
          Results: [{ VIN: vin, Make: "HONDA", ErrorCode: "0" }],
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  expect(
    await Effect.runPromise(decodeHollanderstoresBatch([vin], gate)),
  ).toEqual({ [vin]: "HONDA" });
  for (const values of [
    [],
    [vin, vin],
    Array.from({ length: 51 }, () => vin),
    ["INVALID"],
  ])
    expect(
      (await Effect.runPromiseExit(decodeHollanderstoresBatch(values, gate)))
        ._tag,
    ).toBe("Failure");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
test("foreign VINs fail and empty make decodes remain explicit rejects", async () => {
  fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      Count: 1,
      Results: [{ VIN: "5J8TB4H35DL015046", Make: "ACURA", ErrorCode: "0" }],
    }),
  );
  expect(
    (await Effect.runPromiseExit(decodeHollanderstoresBatch([vin], gate)))._tag,
  ).toBe("Failure");
  fetchMock.mockResolvedValue(
    Response.json({
      Count: 1,
      Results: [{ VIN: vin, Make: "", ErrorCode: "7" }],
    }),
  );
  expect(
    await Effect.runPromise(decodeHollanderstoresBatch([vin], gate)),
  ).toEqual({ [vin]: null });
});
test("successful VIN makes survive separate runs, nulls are never cached, native conflicts need no decode", async () => {
  const stored = new Map<string, string>();
  let decodes = 0,
    writes = 0;
  const cache: HollanderstoresMakeCache = {
    read: (vins) => Effect.succeed(vins.map((vin) => stored.get(vin) ?? null)),
    write: (makes) =>
      Effect.sync(() => {
        writes++;
        for (const [vin, make] of Object.entries(makes)) stored.set(vin, make);
      }),
  };
  const decode = (vins: readonly string[]) =>
    Effect.sync(() => {
      decodes++;
      return Object.fromEntries(vins.map((vin) => [vin, "HONDA"]));
    });
  expect(
    await Effect.runPromise(loadHollanderstoresMakes([vin], cache, decode)),
  ).toEqual({ [vin]: "HONDA" });
  expect(
    await Effect.runPromise(loadHollanderstoresMakes([vin], cache, decode)),
  ).toEqual({ [vin]: "HONDA" });
  expect(
    await Effect.runPromise(cachedHollanderstoresMakes([vin], cache)),
  ).toEqual({ [vin]: "HONDA" });
  expect(decodes).toBe(1);
  expect(writes).toBe(1);
  expect(
    await Effect.runPromise(
      loadHollanderstoresMakes(["5J8TB4H35DL015046"], cache, decode),
    ),
  ).toEqual({ "5J8TB4H35DL015046": "ACURA" });
  expect(decodes).toBe(1);
  stored.clear();
  expect(
    await Effect.runPromise(
      loadHollanderstoresMakes([vin], cache, () =>
        Effect.succeed({ [vin]: null }),
      ),
    ),
  ).toEqual({ [vin]: null });
  expect(stored.size).toBe(0);
});
test("persistent cache outages preserve failure without sending a decode", async () => {
  let decoded = false;
  const cache: HollanderstoresMakeCache = {
    read: () =>
      Effect.fail(
        new HollanderstoresProviderError({
          operation: "cache",
          cause: "offline",
        }),
      ),
    write: () => Effect.void,
  };
  const result = await Effect.runPromiseExit(
    loadHollanderstoresMakes([vin], cache, () => {
      decoded = true;
      return Effect.succeed({ [vin]: "HONDA" });
    }),
  );
  expect(result._tag).toBe("Failure");
  expect(decoded).toBe(false);
});

test("temporary native Message redirect retries slowly and cancels its body", async () => {
  let calls = 0,
    canceled = 0;
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async () => {
        calls++;
        return calls === 1
          ? new Response(
              new ReadableStream({
                cancel() {
                  canceled++;
                },
              }),
              {
                status: 302,
                headers: { location: "/Message", "content-type": "text/html" },
              },
            )
          : new Response("complete", {
              headers: { "content-type": "text/html" },
            });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const { Fiber, TestClock, TestContext } = await import("effect");
  const value = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        fetchHollanderstoresPage(HOLLANDERSTORES_YARDS[0], gate),
      );
      yield* TestClock.adjust("20 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(value).toBe("complete");
  expect(calls).toBe(2);
  expect(canceled).toBe(1);
});

test("a stalled response body times out, cancels and unlocks before retry", async () => {
  const { Fiber, TestClock, TestContext } = await import("effect");
  let calls = 0,
    canceled = 0;
  let signal: AbortSignal | null | undefined;
  const stalled = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        canceled++;
      },
    }),
    { headers: { "content-type": "text/html" } },
  );
  fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls++;
        if (calls === 1) {
          signal = init?.signal;
          return stalled;
        }
        expect(canceled).toBe(1);
        expect(stalled.body?.locked).toBe(false);
        return new Response("complete", {
          headers: { "content-type": "text/html" },
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        fetchHollanderstoresPage(HOLLANDERSTORES_YARDS[0], gate),
      );
      yield* TestClock.adjust("140 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result).toBe("complete");
  expect(signal?.aborted).toBe(true);
  expect(calls).toBe(2);
});
