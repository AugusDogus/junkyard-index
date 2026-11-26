import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import {
  streamChazInventory,
  streamChazInventoryWithRequestGate,
  type ChazStreamResult,
} from "./chaz-connector";
import { ChazCursor, ChazCursorSchema } from "./chaz-cursor";
import type { ChazRecord } from "./chaz-parser";
import type { ChazCanonicalVehicle } from "./chaz-transform";
import {
  CHAZ_CONTACT,
  CHAZ_MAKES,
  CHAZ_ORIGIN,
  CHAZ_ROOT,
} from "./chaz-yard-metadata";
import {
  chazFixtureContact,
  chazFixtureDirectory,
  chazFixtureMake,
  chazFixtureModel,
  chazFixtureModelPage,
  chazFixtureRecord,
  chazFixtureRoot,
} from "./chaz-test-fixtures";
import {
  isDurableSourceCursorTerminal,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";
import {
  ProviderChunkClock,
  ProviderNotReadyDeferred,
} from "./provider-chunk-clock";
import {
  queuedHostPacing,
  runWithQueuedHost,
} from "./provider-host-test-support";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function transport(
  arrivals: ChazRecord[] = [chazFixtureRecord(1)],
  statuses = new Map<string, number>(),
) {
  const rows = Array.from({ length: 901 }, (_, index) =>
    chazFixtureRecord(index + 1),
  );
  const bodies = new Map([
    [CHAZ_CONTACT, chazFixtureContact],
    [CHAZ_ROOT, chazFixtureRoot(arrivals)],
    [CHAZ_MAKES, chazFixtureDirectory([chazFixtureMake], "makes")],
    [
      CHAZ_ORIGIN + chazFixtureMake.path,
      chazFixtureDirectory([chazFixtureModel], "models"),
    ],
    [CHAZ_ORIGIN + chazFixtureModel.path, chazFixtureModelPage(rows)],
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
      const status = statuses.get(url);
      if (status !== undefined)
        return new Response("unavailable", {
          status,
          headers: { "content-type": "text/html" },
        });
      const body = bodies.get(url);
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

test("Chaz resumes serialized chunks and quarantines required conflicts before any callbacks", async () => {
  const conflict = chazFixtureRecord(1);
  conflict[2] = "ACURA RDX";
  const arrivals = [chazFixtureRecord(2), chazFixtureRecord(902), conflict];
  const native = transport(arrivals);
  let cursor: ChazCursor = ChazCursor.initial;
  const vehicles: ChazCanonicalVehicle[] = [];
  let yards = 0;
  let chunks = 0;
  while (cursor.phase !== "complete") {
    const before = native.urls.length;
    const result = await Effect.runPromise(
      streamChazInventoryWithRequestGate(
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
        recordsProcessed: 904,
        recordsExcluded: 0,
        recordsRejected: 2,
        duplicateVehicles: 1,
      });
      expect(result.observedVins).toEqual([conflict[0]]);
    }
    cursor = ChazCursor.parse(ChazCursor.serialize(result.cursor));
    chunks++;
  }
  // Opening contact, arrivals, makes, one menu and one model; closing contact
  // and makes.
  expect(chunks).toBe(4);
  expect(native.urls).toHaveLength(7);
  expect(vehicles).toHaveLength(901);
  expect(vehicles.some((vehicle) => vehicle.vin === conflict[0])).toBe(false);
  expect(
    vehicles.some((vehicle) => vehicle.vin === chazFixtureRecord(902)[0]),
  ).toBe(true);
  expect(yards).toBe(1);
  expect(
    native.urls.every(
      (url) => !url.includes("/images/") && !/\/ST\d+\//.test(url),
    ),
  ).toBe(true);
});

test("Chaz rejects checksum, noncontiguous prefix and foreign graph before further fetching", async () => {
  const native = transport();
  const first = await Effect.runPromise(
    streamChazInventoryWithRequestGate(
      { maxPages: 4, onBatch: () => Effect.void },
      gate,
    ),
  );
  if (first.cursor.phase === "complete")
    throw new Error("Expected directory checkpoint");
  const state = first.cursor;
  expect(() =>
    ChazCursorSchema.parse({ ...state, requests: state.requests + 1 }),
  ).toThrow("integrity");
  expect(() =>
    ChazCursor.checkpoint({ ...state, requests: state.requests + 1 }),
  ).toThrow("request accounting");
  expect(() =>
    ChazCursor.checkpoint({
      ...state,
      makes: state.makes.map((make) => ({
        ...make,
        path: "https://example.com/foreign",
      })),
    }),
  ).toThrow("destination");
  expect(() =>
    ChazCursor.checkpoint({
      ...state,
      phase: "models",
      pages: [],
      makes: [{ ...chazFixtureMake, models: null }],
    }),
  ).toThrow("contiguous");
  const before = native.urls.length;
  await expect(
    Effect.runPromise(
      streamChazInventoryWithRequestGate(
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

test("Chaz changed closing make directory fails without callbacks or accepting a new checkpoint", async () => {
  const native = transport();
  const first = await Effect.runPromise(
    streamChazInventoryWithRequestGate(
      { maxPages: 6, onBatch: () => Effect.void },
      gate,
    ),
  );
  const wire = ChazCursor.serialize(first.cursor);
  native.bodies.set(
    CHAZ_MAKES,
    chazFixtureDirectory([{ ...chazFixtureMake, count: 902 }], "makes"),
  );
  let callbacks = 0;
  const callback = () =>
    Effect.sync(() => {
      callbacks++;
    });
  await expect(
    Effect.runPromise(
      streamChazInventoryWithRequestGate(
        { startCursor: first.cursor, onBatch: callback, onYards: callback },
        gate,
      ),
    ),
  ).rejects.toThrow("Closing Chaz make directory");
  expect(callbacks).toBe(0);
  expect(ChazCursor.serialize(first.cursor)).toBe(wire);
  expect(first.status).toBe("paused");
});

test("Chaz HTTP failures do not retry and completed cursors make no requests", async () => {
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
      streamChazInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
    ),
  ).rejects.toThrow("503");
  expect(requests).toBe(1);
  const complete = await Effect.runPromise(
    streamChazInventoryWithRequestGate(
      {
        startCursor: { source: "chaz", version: 1, phase: "complete" },
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  expect(complete.status).toBe("complete");
  expect(complete.pagesProcessed).toBe(0);
  expect(requests).toBe(1);
});

// Production 2026-11-26: chazsauto.com answered 503 on single pages for 44 s
// to 4.6 min while neighbouring GETs returned 200.
const failedRun = (cursor: ChazCursor = ChazCursor.initial) =>
  Effect.runPromise(
    streamChazInventoryWithRequestGate(
      { startCursor: cursor, onBatch: () => Effect.void },
      gate,
    ),
  ).then(
    () => {
      throw new Error("Expected the Chaz chunk to fail");
    },
    (error: unknown) => error,
  );

test.each([502, 503, 504])(
  "Chaz defers the chunk when its first native GET answers HTTP %i",
  async (status) => {
    const native = transport(undefined, new Map([[CHAZ_CONTACT, status]]));
    const deferral = ProviderChunkClock.deferralOf(await failedRun());
    expect(deferral).toBeInstanceOf(ProviderNotReadyDeferred);
    expect(deferral?.message).toContain(CHAZ_CONTACT);
    expect(deferral?.message).toContain("HTTP " + status);
    expect(native.urls).toEqual([CHAZ_CONTACT]);
  },
);

test("Chaz keeps a chunk's validated GETs when a later native GET answers HTTP 503", async () => {
  const statuses = new Map([[CHAZ_MAKES, 503]]);
  const native = transport(undefined, statuses);
  const result = await Effect.runPromise(
    streamChazInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
  );
  expect(result.status).toBe("paused");
  expect(result.pagesProcessed).toBe(2);
  expect(result.cursor.phase).toBe("directory");
  expect(native.urls).toEqual([CHAZ_CONTACT, CHAZ_ROOT, CHAZ_MAKES]);
  // The next chunk resumes at the same native GET once the origin recovers.
  statuses.clear();
  const resumed = await Effect.runPromise(
    streamChazInventoryWithRequestGate(
      {
        startCursor: ChazCursor.parse(ChazCursor.serialize(result.cursor)),
        maxPages: 1,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  expect(resumed.pagesProcessed).toBe(1);
  expect(native.urls.slice(3)).toEqual([CHAZ_MAKES]);
});

test.each([404, 429, 500])(
  "Chaz HTTP %i stays fatal, also after the chunk advanced",
  async (status) => {
    transport(undefined, new Map([[CHAZ_CONTACT, status]]));
    const first = await failedRun();
    expect(ProviderChunkClock.deferralOf(first)).toBeNull();
    expect(String(first)).toContain(String(status));
    const native = transport(undefined, new Map([[CHAZ_MAKES, status]]));
    const later = await failedRun();
    expect(ProviderChunkClock.deferralOf(later)).toBeNull();
    expect(String(later)).toContain(String(status));
    expect(native.urls).toEqual([CHAZ_CONTACT, CHAZ_ROOT, CHAZ_MAKES]);
  },
);

test("Chaz's own 1.6 s gate runs after its shared host lease", async () => {
  // Several sources share a URG lane. A gate inside the lease idled the lane
  // after every request on top of its 3.5 s host gap.
  transport();
  const chunk = await runWithQueuedHost(
    streamChazInventory({
      startCursor: ChazCursor.initial,
      maxPages: 8,
      onBatch: () => Effect.void,
    }),
    { turnWaitMs: 0 },
  );
  if (Either.isLeft(chunk.result)) throw chunk.result.left;
  expect(chunk.requests.length).toBeGreaterThan(2);
  const pacing = queuedHostPacing(chunk);
  // The request (instant here) and the 3.5 s gap, in whole test seconds.
  expect(pacing.longestLeaseMs).toBeLessThanOrEqual(4_000);
  // The gap and the gate still both pass before the source's next request.
  expect(pacing.shortestGapMs).toBeGreaterThanOrEqual(5_000);
}, 60_000);

test("Chaz completes a full crawl when every request waits two minutes for a shared host turn", async () => {
  // Production URG queue on 2026-11-19: about 20 sources shared one lease, so
  // each request waited about two minutes for its turn.
  const { urls } = transport();
  let cursor: ChazCursor = ChazCursor.initial;
  const pages: number[] = [];
  let count = 0;
  while (cursor.phase !== "complete") {
    const chunk = await runWithQueuedHost(
      streamChazInventory({
        startCursor: cursor,
        maxPages: 8,
        onBatch: () => Effect.void,
      }),
      { turnWaitMs: 2 * 60_000 },
    );
    if (Either.isLeft(chunk.result)) throw chunk.result.left;
    const result: ChazStreamResult = chunk.result.right;
    pages.push(result.pagesProcessed);
    count = result.count;
    cursor = ChazCursor.parse(ChazCursor.serialize(result.cursor));
    // Every chunk returns its checkpoint and releases each lease in time.
    expect(result.pagesProcessed).toBeGreaterThan(0);
    expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
  }
  expect(pages).toEqual([2, 2, 2, 1]);
  expect(count).toBe(901);
  expect(urls).toHaveLength(7);
}, 120_000);

test("Chaz terminal evidence is a complete cursor carrying the model census, and a mid-crawl cursor is not terminal", async () => {
  transport();
  let cursor: ChazCursor = ChazCursor.initial;
  let midWire: string | null = null;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamChazInventoryWithRequestGate(
        { startCursor: cursor, maxPages: 2, onBatch: () => Effect.void },
        gate,
      ),
    );
    cursor = ChazCursor.parse(ChazCursor.serialize(result.cursor));
    if (midWire === null && result.status === "paused")
      midWire = serializeDurableSourceCursor(cursor);
  }
  const wire = serializeDurableSourceCursor(cursor);
  const parsed = parseDurableSourceCursor("chaz", wire);
  expect(serializeDurableSourceCursor(parsed)).toBe(wire);
  if (parsed.phase !== "complete")
    throw new Error("Expected a complete Chaz cursor");
  expect(parsed.census?.models.length ?? 0).toBeGreaterThan(0);
  expect(isDurableSourceCursorTerminal("chaz", wire)).toBe(true);
  if (midWire === null) throw new Error("Expected a paused Chaz chunk");
  expect(parseDurableSourceCursor("chaz", midWire).phase).not.toBe("complete");
  expect(isDurableSourceCursorTerminal("chaz", midWire)).toBe(false);
});
