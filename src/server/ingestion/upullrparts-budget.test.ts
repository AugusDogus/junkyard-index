import { afterEach, expect, test } from "bun:test";
import {
  Cause,
  Clock,
  Effect,
  Fiber,
  Option,
  Runtime,
  TestClock,
  TestContext,
} from "effect";
import fixture from "./fixtures/upullrparts-vehicle.json";
import {
  streamUpullRPartsInventory,
  streamUpullRPartsInventoryWithRequestGate,
} from "./upullrparts-connector";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("3,311 unique stocks plus make fallback and a late photo transport retry fit the production deadline", async () => {
  const catalog = Array.from({ length: 3311 }, (_, i) => ({
    ...fixture,
    Store: (i % 3) + 1,
    VIN: String(i).padStart(17, "0"),
    StockNumber: `UG${String(i).padStart(6, "0")}`,
  }));
  const requests = new Map<string, number>();
  const requestedStocks = new Set<string>();
  const catalogStarts: number[] = [];
  let activePhotos = 0;
  let peakPhotos = 0;
  let photosCompleted = 0;
  let networkFailures = 0;
  let firstPhotoAt: number | undefined;
  let finishedAt: number | undefined;
  let yardsEmitted = 0;
  let photoCount = 0;
  const emittedVins: string[] = [];
  const batchSizes: number[] = [];

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      // Capture the TestClock runtime so mocked HTTP latency advances virtual,
      // not wall, time. Exercise the production gate and eight-worker image pool.
      const runPromise = Runtime.runPromise(yield* Effect.runtime());
      globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const response = await runPromise(
            Effect.gen(function* () {
              expect(String(input)).toBe(
                "https://upullrparts.com/wp-admin/admin-ajax.php",
              );
              const params = new URLSearchParams(
                typeof init?.body === "string" ? init.body : "",
              );
              const action = params.get("apiAction") ?? "";
              requests.set(action, (requests.get(action) ?? 0) + 1);
              const now = yield* Clock.currentTimeMillis;
              if (action === "getVehicleImages") {
                expect(params.get("action")).toBe("doAaaApiCall");
                const stock = params.get("stockID") ?? "";
                requestedStocks.add(stock);
                firstPhotoAt ??= now;
                activePhotos++;
                peakPhotos = Math.max(peakPhotos, activePhotos);
                // Full live run implied ~725ms/photo at eight workers. Round up to
                // 750ms rather than using the faster ~500ms individual sample calls.
                yield* Effect.sleep("750 millis");
                activePhotos--;
                // Fail the last stock once so retry/backoff is on the critical
                // path, after almost the entire catalog has been fetched.
                if (stock === "UG003310" && networkFailures === 0) {
                  networkFailures++;
                  return new TypeError("fetch failed");
                }
                photosCompleted++;
                const fileName = `${stock}_6_Facebook_1789569476269.jpg`;
                return Response.json({
                  success: 1,
                  images:
                    Number(stock.slice(2)) < 3017
                      ? [
                          {
                            fileName,
                            url: `https://api.aaaparts.com/staticImages/${fileName}`,
                          },
                        ]
                      : [],
                });
              }
              expect(params.get("action")).toBe("doApiCall");
              catalogStarts.push(now);
              yield* Effect.sleep("750 millis");
              if (action === "getMakes")
                return Response.json([
                  "Ford",
                  ...Array.from({ length: 55 }, (_, i) => `Make-${i}`),
                ]);
              if (action === "getModels")
                return Response.json(
                  params.get("Make") === "Ford" ? ["FOCUS"] : [],
                );
              // Force all 56 make partitions and all 56 fallback model requests.
              return Response.json(params.has("makes") ? [] : catalog);
            }),
          );
          // Throw the original fetch-shaped error, not Runtime's FiberFailure.
          if (response instanceof TypeError) throw response;
          return response;
        },
        { preconnect: originalFetch.preconnect },
      );
      const fiber = yield* Effect.fork(
        streamUpullRPartsInventory({
          onYards: () =>
            Effect.sync(() => {
              expect(photosCompleted).toBe(3311);
              yardsEmitted++;
            }),
          onBatch: (batch) =>
            Effect.gen(function* () {
              expect(photosCompleted).toBe(3311);
              finishedAt = yield* Clock.currentTimeMillis;
              batchSizes.push(batch.length);
              for (const vehicle of batch) {
                expect(vehicle.make).toBe("Ford");
                if (vehicle.imageUrl !== null) photoCount++;
                emittedVins.push(vehicle.vin);
              }
            }),
        }),
      );
      yield* TestClock.adjust("480 seconds");
      expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
      expect(yardsEmitted).toBe(0);
      expect(batchSizes).toEqual([]);
      yield* TestClock.adjust("3 seconds");
      expect(Option.isSome(yield* Fiber.poll(fiber))).toBe(true);
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );

  expect(Object.fromEntries(requests)).toEqual({
    getVehicles: 57,
    getMakes: 1,
    getModels: 56,
    getVehicleImages: 3312,
  });
  expect(requestedStocks.size).toBe(3311);
  expect(networkFailures).toBe(1);
  expect(peakPhotos).toBe(8);
  expect(activePhotos).toBe(0);
  for (let i = 1; i < catalogStarts.length; i++) {
    expect(
      (catalogStarts[i] ?? 0) - (catalogStarts[i - 1] ?? 0),
    ).toBeGreaterThanOrEqual(1500);
  }
  expect(firstPhotoAt).toBe(170250);
  expect(finishedAt).toBe(482500);
  expect(yardsEmitted).toBe(1);
  expect(batchSizes).toEqual([...Array.from({ length: 13 }, () => 250), 61]);
  expect(emittedVins).toEqual(catalog.map((row) => row.VIN));
  expect(photoCount).toBe(3017);
  expect(result).toMatchObject({
    status: "complete",
    cursor: 1,
    count: 3311,
    pagesProcessed: 1,
    errors: [],
    warnings: [],
    observedVins: [],
    accounting: {
      recordsProcessed: 3311,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
}, 20000);

test("allows a complete make fallback when provider responses take 2.2 seconds", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests++;
      const params = new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      );
      if (params.get("apiAction") === "getVehicleImages")
        return Response.json({ success: 1, images: [] });
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
  expect(requests).toBe(115);
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

test("photo enrichment shares the ten-minute deadline and cannot publish a partial catalog", async () => {
  let photoStarted = false;
  let emitted = 0;
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const params = new URLSearchParams(
        typeof init?.body === "string" ? init.body : "",
      );
      if (params.get("apiAction") === "getVehicleImages") {
        photoStarted = true;
        return new Promise<Response>(() => {});
      }
      if (params.get("apiAction") === "getMakes")
        return Response.json(["Ford"]);
      return Response.json([
        fixture,
        { ...fixture, Store: 2, VIN: "VIN-2" },
        { ...fixture, Store: 3, VIN: "VIN-3" },
      ]);
    },
    { preconnect: originalFetch.preconnect },
  );
  const onBatch = () =>
    Effect.sync(() => {
      emitted++;
    });
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        streamUpullRPartsInventoryWithRequestGate(
          { onBatch, onYards: onBatch },
          (request) => request,
        ),
      );
      yield* TestClock.adjust("9 minutes");
      expect(photoStarted).toBe(true);
      expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
      yield* TestClock.adjust("1 minute");
      return yield* Fiber.await(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(exit._tag).toBe("Failure");
  if (exit._tag === "Failure")
    expect(Cause.pretty(exit.cause)).toContain(
      "photos exceeded the ten-minute checkpoint budget",
    );
  expect(emitted).toBe(0);
});
