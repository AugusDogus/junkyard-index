import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamAplusInventoryWithRequestGate } from "./aplus-connector";
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

test("Aplus resumes serialized chunks and quarantines late required conflicts before any callbacks", async () => {
  const conflict = aplusFixtureRecord(1);
  conflict[2] = "ACURA RDX";
  const arrivals = [aplusFixtureRecord(2), aplusFixtureRecord(1001)];
  const native = transport(arrivals, [...arrivals, conflict]);
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
  expect(chunks).toBe(5);
  expect(native.urls).toHaveLength(10);
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

test("Aplus changed closing donor controls fail without callbacks or accepting a new checkpoint", async () => {
  const native = transport();
  const first = await Effect.runPromise(
    streamAplusInventoryWithRequestGate(
      { maxPages: 8, onBatch: () => Effect.void },
      gate,
    ),
  );
  const wire = AplusCursor.serialize(first.cursor);
  const changed = aplusFixtureRecord(1);
  changed[6] = "2026-10-22";
  native.bodies.set(
    APLUS_ORIGIN + aplusFixtureModel.path,
    aplusFixtureModelPage([changed, ...native.rows.slice(1)]),
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
  ).rejects.toThrow("Closing Aplus model list");
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
      { maxPages: 8, onBatch: () => Effect.void },
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
  expect(() => AplusCursor.parse(" ".repeat(1024 * 1024 + 1))).toThrow(
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
