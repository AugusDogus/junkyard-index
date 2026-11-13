import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamCoutuInventoryWithRequestGate } from "./coutu-connector";
import { CoutuCursor, CoutuCursorSchema } from "./coutu-cursor";
import type { CoutuCanonicalVehicle } from "./coutu-transform";
import { COUTU_HOME, COUTU_ROOT, COUTU_ORIGIN } from "./coutu-protocol";
import {
  coutuFixtureHome,
  coutuFixtureMake,
  coutuFixtureModel,
  coutuFixtureOtherModel,
  coutuFixtureRecord,
  coutuFixtureDirectory,
  coutuFixtureModelPage,
} from "./coutu-test-fixtures";

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function transport() {
  const first = Array.from({ length: 1000 }, (_, i) =>
    coutuFixtureRecord(i + 1),
  );
  const second = [1001, 1002, 1003, 1].map((i) =>
    coutuFixtureRecord(i, "F350"),
  );
  const bodies = new Map([
    [COUTU_HOME, coutuFixtureHome],
    [COUTU_ROOT, coutuFixtureDirectory([coutuFixtureMake])],
    [
      COUTU_ORIGIN + coutuFixtureMake.path,
      coutuFixtureDirectory(
        [coutuFixtureModel, coutuFixtureOtherModel],
        coutuFixtureMake,
      ),
    ],
    [COUTU_ORIGIN + coutuFixtureModel.path, coutuFixtureModelPage(first)],
    [
      COUTU_ORIGIN + coutuFixtureOtherModel.path,
      coutuFixtureModelPage(second, coutuFixtureMake, coutuFixtureOtherModel),
    ],
  ]);
  const urls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      urls.push(url);
      const body = bodies.get(url);
      if (body === undefined)
        throw new Error("Unexpected native request " + url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  return { first, second, bodies, urls };
}

test("Coutu serializes/resumes raw rejected VIN presence and emits only after complete closure", async () => {
  const native = transport();
  let cursor: CoutuCursor = CoutuCursor.initial;
  const vehicles: CoutuCanonicalVehicle[] = [];
  let yards = 0;
  let chunks = 0;
  while (cursor.phase !== "complete") {
    const before = native.urls.length;
    const result = await Effect.runPromise(
      streamCoutuInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 2,
          onBatch: (rows) =>
            Effect.sync(() => {
              vehicles.push(...rows);
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
      expect(Object.values(result.accounting)).toEqual([0, 0, 0, 0]);
    } else {
      expect(result.count).toBe(1002);
      expect(result.observedVins).toEqual([coutuFixtureRecord(1)[0]]);
      expect(result.accounting).toEqual({
        recordsProcessed: 1004,
        recordsExcluded: 0,
        recordsRejected: 2,
        duplicateVehicles: 0,
      });
    }
    cursor = CoutuCursor.parse(CoutuCursor.serialize(result.cursor));
    chunks++;
  }
  expect(chunks).toBe(5);
  expect(native.urls).toHaveLength(10);
  expect(vehicles).toHaveLength(1002);
  expect(vehicles.some((v) => v.vin === coutuFixtureRecord(1)[0])).toBe(false);
  expect(yards).toBe(1);
});

test("Coutu rejects corrupt cursors and inconsistent request/model prefixes before fetching", async () => {
  const native = transport();
  const first = await Effect.runPromise(
    streamCoutuInventoryWithRequestGate(
      { maxPages: 4, onBatch: () => Effect.void },
      gate,
    ),
  );
  if (first.cursor.phase === "complete")
    throw new Error("Expected raw model checkpoint");
  const state = first.cursor;
  expect(() =>
    CoutuCursorSchema.parse({ ...state, requests: state.requests + 1 }),
  ).toThrow("integrity");
  expect(() =>
    CoutuCursor.checkpoint({ ...state, requests: state.requests + 1 }),
  ).toThrow("request accounting");
  expect(() =>
    CoutuCursor.checkpoint({
      ...state,
      makes: state.makes.map((m) => ({
        ...m,
        path: "https://example.com/foreign",
      })),
    }),
  ).toThrow("destination");
  expect(() =>
    CoutuCursor.checkpoint({
      ...state,
      phase: "models",
      pages: [],
      makes: [{ ...coutuFixtureMake, models: null }],
    }),
  ).toThrow("contiguous");
  expect(() => CoutuCursor.parse(" ".repeat(1024 * 1024 + 1))).toThrow("1 MiB");
  const before = native.urls.length;
  await expect(
    Effect.runPromise(
      streamCoutuInventoryWithRequestGate(
        {
          startCursor: { ...state, checksum: "0".repeat(64) },
          onBatch: () => Effect.void,
        },
        gate,
      ),
    ),
  ).rejects.toThrow("integrity");
  expect(native.urls.length).toBe(before);
});

test("Coutu changed closing controls fail with no callbacks or accepted advanced checkpoint", async () => {
  const native = transport();
  const first = await Effect.runPromise(
    streamCoutuInventoryWithRequestGate(
      { maxPages: 8, onBatch: () => Effect.void },
      gate,
    ),
  );
  const wire = CoutuCursor.serialize(first.cursor);
  native.bodies.set(
    COUTU_ORIGIN + coutuFixtureModel.path,
    coutuFixtureModelPage(native.first.slice(1)),
  );
  let callbacks = 0;
  const callback = () =>
    Effect.sync(() => {
      callbacks++;
    });
  await expect(
    Effect.runPromise(
      streamCoutuInventoryWithRequestGate(
        { startCursor: first.cursor, onBatch: callback, onYards: callback },
        gate,
      ),
    ),
  ).rejects.toThrow("Closing Coutu model list");
  expect(callbacks).toBe(0);
  expect(CoutuCursor.serialize(first.cursor)).toBe(wire);
});

test("Coutu completed cursors make no HTTP calls and request failures never retry", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response("failure", { status: 503 });
    },
    { preconnect: original.preconnect },
  );
  await expect(
    Effect.runPromise(
      streamCoutuInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
    ),
  ).rejects.toThrow("prior inventory is preserved");
  expect(requests).toBe(1);
  const result = await Effect.runPromise(
    streamCoutuInventoryWithRequestGate(
      {
        startCursor: { source: "coutu", version: 1, phase: "complete" },
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.pagesProcessed).toBe(0);
  expect(requests).toBe(1);
});
