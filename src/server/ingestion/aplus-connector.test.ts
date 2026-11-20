import { afterEach, expect, test } from "bun:test";
import { Effect, Either, Fiber, TestClock, TestContext } from "effect";
import {
  streamAplusInventory,
  streamAplusInventoryWithRequestGate,
} from "./aplus-connector";
import { AplusCursor, AplusCursorSchema } from "./aplus-cursor";
import type { AplusRecord } from "./aplus-parser";
import type { AplusCanonicalVehicle } from "./aplus-transform";
import {
  APLUS_CONTACT,
  APLUS_MAKES,
  APLUS_ORIGIN,
  APLUS_ROOT,
} from "./aplus-yard-metadata";
import {
  aplusFixtureContact,
  aplusFixtureDirectory,
  aplusFixtureMake,
  aplusFixtureModel,
  aplusFixtureModelPage,
  aplusFixtureRecord,
  aplusFixtureRoot,
} from "./aplus-test-fixtures";
import { runWithQueuedHost } from "./provider-host-test-support";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function transport(
  arrivals: AplusRecord[] = [aplusFixtureRecord(1)],
  closingArrivals = arrivals,
) {
  const rows = Array.from({ length: 1000 }, (_, index) =>
    aplusFixtureRecord(index + 1),
  );
  const bodies = new Map([
    [APLUS_CONTACT, aplusFixtureContact],
    [APLUS_ROOT, aplusFixtureRoot(arrivals)],
    [APLUS_MAKES, aplusFixtureDirectory([aplusFixtureMake], "makes")],
    [
      APLUS_ORIGIN + aplusFixtureMake.path,
      aplusFixtureDirectory([aplusFixtureModel], "models"),
    ],
    [APLUS_ORIGIN + aplusFixtureModel.path, aplusFixtureModelPage(rows)],
  ]);
  const urls: string[] = [];
  let roots = 0;
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      urls.push(url);
      const body =
        url === APLUS_ROOT && roots++ > 0
          ? aplusFixtureRoot(closingArrivals)
          : bodies.get(url);
      if (body === undefined)
        throw new Error("Unexpected native request " + url);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return { bodies, urls, rows };
}

test("Aplus resumes serialized chunks and quarantines required conflicts before any callbacks", async () => {
  const conflict = aplusFixtureRecord(1);
  conflict[2] = "ACURA RDX";
  const arrivals = [aplusFixtureRecord(2), aplusFixtureRecord(1001), conflict];
  const native = transport(arrivals);
  let cursor: AplusCursor = AplusCursor.initial;
  const vehicles: AplusCanonicalVehicle[] = [];
  let yards = 0;
  let chunks = 0;
  while (cursor.phase !== "complete") {
    const before = native.urls.length;
    const result = await Effect.runPromise(
      streamAplusInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 2,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
          onYards: (rows) =>
            Effect.sync(() => {
              yards += rows.length;
            }),
        },
        gate,
      ),
    );
    expect(result.pagesProcessed).toBe(native.urls.length - before);
    expect(result.pagesProcessed).toBeLessThanOrEqual(2);
    if (result.status === "paused") {
      expect(vehicles).toHaveLength(0);
      expect(yards).toBe(0);
      expect(result.count).toBe(0);
      expect(result.observedVins).toHaveLength(0);
      expect(result.accounting.recordsProcessed).toBe(0);
    } else {
      expect(result.accounting).toEqual({
        recordsProcessed: 1003,
        recordsExcluded: 0,
        recordsRejected: 2,
        duplicateVehicles: 1,
      });
      expect(result.observedVins).toEqual([conflict[0]]);
    }
    cursor = AplusCursor.parse(AplusCursor.serialize(result.cursor));
    chunks++;
  }
  // Opening contact, arrivals, makes, one menu and one model; closing contact
  // and makes.
  expect(chunks).toBe(4);
  expect(native.urls).toHaveLength(7);
  expect(vehicles).toHaveLength(1000);
  expect(vehicles.some((vehicle) => vehicle.vin === conflict[0])).toBe(false);
  expect(
    vehicles.some((vehicle) => vehicle.vin === aplusFixtureRecord(1001)[0]),
  ).toBe(true);
  expect(yards).toBe(1);
  expect(
    native.urls.every(
      (url) => !url.includes("/images/") && !/\/ST\d+\//.test(url),
    ),
  ).toBe(true);
});

test("Aplus keeps a chunk alive when one model page misses its deadline once", async () => {
  // Production runs failed in the models phase when one dynamic model page
  // exceeded the old 20 second deadline, discarding the whole chunk.
  const native = transport();
  const nativeFetch = globalThis.fetch;
  const modelUrl = APLUS_ORIGIN + aplusFixtureModel.path;
  let stalled: AbortSignal | null = null;
  globalThis.fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      if (input !== modelUrl || stalled || !signal)
        return nativeFetch(input, init);
      stalled = signal;
      native.urls.push(modelUrl);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const settle = Effect.promise(
    () => new Promise((resolve) => setTimeout(resolve, 1)),
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        streamAplusInventoryWithRequestGate(
          { maxPages: 8, onBatch: () => Effect.void },
          gate,
        ),
      );
      while (!stalled) yield* settle;
      yield* TestClock.adjust("40 seconds");
      while (!native.urls.slice(5).includes(modelUrl)) {
        yield* settle;
        yield* TestClock.adjust("1 second");
      }
      return yield* Effect.either(Fiber.join(fiber));
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result._tag).toBe("Right");
  if (result._tag !== "Right") throw new Error("Expected a completed chunk");
  // The stalled attempt and its retry; the chunk still closes the census.
  expect(native.urls.filter((url) => url === modelUrl)).toHaveLength(2);
  expect(result.right.pagesProcessed).toBe(7);
  expect(result.right.status).toBe("complete");
  expect(result.right.count).toBe(1000);
});

test("Aplus rejects checksum, noncontiguous prefix and foreign graph before further fetching", async () => {
  const native = transport();
  const first = await Effect.runPromise(
    streamAplusInventoryWithRequestGate(
      { maxPages: 4, onBatch: () => Effect.void },
      gate,
    ),
  );
  if (first.cursor.phase === "complete")
    throw new Error("Expected directory checkpoint");
  const state = first.cursor;
  expect(() =>
    AplusCursorSchema.parse({ ...state, requests: state.requests + 1 }),
  ).toThrow("integrity");
  expect(() =>
    AplusCursor.checkpoint({ ...state, requests: state.requests + 1 }),
  ).toThrow("request accounting");
  expect(() =>
    AplusCursor.checkpoint({
      ...state,
      makes: state.makes.map((make) => ({
        ...make,
        path: "https://example.com/foreign",
      })),
    }),
  ).toThrow("destination");
  expect(() =>
    AplusCursor.checkpoint({
      ...state,
      phase: "models",
      pages: [],
      makes: [{ ...aplusFixtureMake, models: null }],
    }),
  ).toThrow("contiguous");
  const before = native.urls.length;
  await expect(
    Effect.runPromise(
      streamAplusInventoryWithRequestGate(
        {
          startCursor: { ...state, checksum: "0".repeat(64) },
          onBatch: () => Effect.void,
        },
        gate,
      ),
    ),
  ).rejects.toThrow("integrity");
  expect(native.urls).toHaveLength(before);
});

test("Aplus changed closing make directory fails without callbacks or accepting a new checkpoint", async () => {
  const native = transport();
  const first = await Effect.runPromise(
    streamAplusInventoryWithRequestGate(
      { maxPages: 5, onBatch: () => Effect.void },
      gate,
    ),
  );
  const wire = AplusCursor.serialize(first.cursor);
  native.bodies.set(
    APLUS_MAKES,
    aplusFixtureDirectory([{ ...aplusFixtureMake, count: 1001 }], "makes"),
  );
  let callbacks = 0;
  const callback = () =>
    Effect.sync(() => {
      callbacks++;
    });
  await expect(
    Effect.runPromise(
      streamAplusInventoryWithRequestGate(
        { startCursor: first.cursor, onBatch: callback, onYards: callback },
        gate,
      ),
    ),
  ).rejects.toThrow("Closing Aplus make directory");
  expect(callbacks).toBe(0);
  expect(AplusCursor.serialize(first.cursor)).toBe(wire);
  expect(first.status).toBe("paused");
});

test("Aplus HTTP failures do not retry and completed cursors make no requests", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response("unavailable", {
        status: 503,
        headers: { "content-type": "text/html" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    Effect.runPromise(
      streamAplusInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
    ),
  ).rejects.toThrow("503");
  expect(requests).toBe(1);
  const complete = await Effect.runPromise(
    streamAplusInventoryWithRequestGate(
      {
        startCursor: { source: "aplus", version: 1, phase: "complete" },
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  expect(complete.status).toBe("complete");
  expect(complete.pagesProcessed).toBe(0);
  expect(requests).toBe(1);
});

test("A Plus callback failures return no completed checkpoint and preserve the original failure", async () => {
  transport();
  const first = await Effect.runPromise(
    streamAplusInventoryWithRequestGate(
      { maxPages: 6, onBatch: () => Effect.void },
      gate,
    ),
  );
  const wire = AplusCursor.serialize(first.cursor);
  for (const kind of ["yards", "batch"] as const) {
    const error = new Error("caller " + kind + " failure");
    const operation = streamAplusInventoryWithRequestGate(
      {
        startCursor: first.cursor,
        onBatch: () => (kind === "batch" ? Effect.fail(error) : Effect.void),
        onYards: () => (kind === "yards" ? Effect.fail(error) : Effect.void),
      },
      gate,
    );
    const result = await Effect.runPromise(Effect.either(operation));
    expect(result._tag).toBe("Left");
    if (result._tag !== "Left") throw new Error("Expected callback failure");
    expect(result.left).toBe(error);
    expect(AplusCursor.serialize(first.cursor)).toBe(wire);
  }
});

test("A Plus rejects oversized wire cursors before decoding and refuses invalid HTTP envelopes without retry", async () => {
  expect(() => AplusCursor.parse(" ".repeat(4 * 1024 * 1024 + 1))).toThrow(
    "wire payload exceeds",
  );
  expect(() => AplusCursor.parse("{")).toThrow("not valid JSON");
  for (const response of [
    new Response("redirect", {
      status: 301,
      headers: { "content-type": "text/html" },
    }),
    new Response("partial", {
      status: 206,
      headers: { "content-type": "text/html" },
    }),
    new Response("partial", {
      status: 200,
      headers: { "content-type": "text/html", "content-range": "bytes 0-6/10" },
    }),
    new Response("wrong type", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ]) {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return response;
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(
      Effect.runPromise(
        streamAplusInventoryWithRequestGate(
          { onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow("complete unredirected");
    expect(requests).toBe(1);
  }
});

test("Aplus keeps advancing when every shared host turn waits minutes", async () => {
  // About 20 URG sources share one lease at 07:00, so each turn waits about
  // 2.5 minutes. The old three-minute wall deadline counted that queue time and
  // failed every chunk before it could return its first page's checkpoint.
  const native = transport();
  let cursor: AplusCursor = AplusCursor.initial;
  const pages: number[] = [];
  let vehicles = 0;
  while (cursor.phase !== "complete" && pages.length < 10) {
    const chunk = await runWithQueuedHost(
      streamAplusInventory({
        startCursor: cursor,
        maxPages: 8,
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles += batch.length;
          }),
      }),
      { turnWaitMs: 150_000 },
    );
    if (Either.isLeft(chunk.result)) throw chunk.result.left;
    pages.push(chunk.result.right.pagesProcessed);
    cursor = AplusCursor.parse(
      AplusCursor.serialize(chunk.result.right.cursor),
    );
    // Every chunk returns its checkpoint and releases each lease in time.
    expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
  }
  expect(cursor.phase).toBe("complete");
  expect(pages).toEqual([2, 2, 2, 1]);
  expect(native.urls).toHaveLength(7);
  expect(vehicles).toBe(1000);
}, 120_000);
