import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import { soakAviationInventory } from "../../../scripts/soak-aviation";
import {
  streamAviationInventory,
  streamAviationInventoryWithRequestGate,
  type AviationStreamResult,
} from "./aviation-connector";
import {
  AviationCursor,
  AviationCursorSchema,
  AVIATION_MAX_CURSOR_BYTES,
} from "./aviation-cursor";
import {
  AVIATION_CONTACT,
  AVIATION_MAKES,
  AVIATION_ORIGIN,
  AVIATION_PARTS,
  AVIATION_ROOT,
} from "./aviation-yard-metadata";
import {
  aviationFixtureContact,
  aviationFixtureDirectory,
  aviationFixtureMake,
  aviationFixtureModel,
  aviationFixtureModelPage,
  aviationFixtureRecord,
  aviationFixtureRoot,
} from "./aviation-test-fixtures";
import type { AviationCanonicalVehicle } from "./aviation-transform";
import type { AviationRecord } from "./aviation-parser";
import {
  MODEL_CENSUS_DAY_MS,
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
} from "./model-census";
import { runWithQueuedHost } from "./provider-host-test-support";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function transport(arrivals: AviationRecord[] = [aviationFixtureRecord(1)]) {
  const rows = Array.from({ length: 21 }, (_, i) =>
    aviationFixtureRecord(i + 1),
  );
  const bodies = new Map([
    [AVIATION_CONTACT, aviationFixtureContact],
    [AVIATION_ROOT, aviationFixtureRoot(arrivals)],
    [AVIATION_PARTS, aviationFixtureDirectory([aviationFixtureMake], "makes")],
    [AVIATION_MAKES, aviationFixtureDirectory([aviationFixtureMake], "makes")],
    [
      AVIATION_ORIGIN + aviationFixtureMake.path,
      aviationFixtureDirectory([aviationFixtureModel], "models"),
    ],
    [
      AVIATION_ORIGIN + aviationFixtureModel.path,
      aviationFixtureModelPage(rows),
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
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return { bodies, urls };
}

test("Aviation serializes small chunks and quarantines late cross-surface conflicts before any emission", async () => {
  const conflict = aviationFixtureRecord(1);
  conflict[2] = "ACURA RDX";
  const native = transport([conflict, aviationFixtureRecord(22)]);
  let cursor: AviationCursor = AviationCursor.initial;
  const vehicles: AviationCanonicalVehicle[] = [];
  let requests = 0,
    chunks = 0,
    processed = 0,
    rejected = 0,
    duplicates = 0;
  while (cursor.phase !== "complete") {
    const before = native.urls.length;
    const result = await Effect.runPromise(
      streamAviationInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 2,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        gate,
      ),
    );
    expect(result.pagesProcessed).toBe(native.urls.length - before);
    expect(result.pagesProcessed).toBeLessThanOrEqual(2);
    if (result.status === "paused") {
      expect(result.count).toBe(0);
      expect(result.accounting.recordsProcessed).toBe(0);
      expect(vehicles).toHaveLength(0);
    }
    const wire: unknown = JSON.parse(JSON.stringify(result.cursor));
    cursor = AviationCursorSchema.parse(wire);
    chunks++;
    requests += result.pagesProcessed;
    processed += result.accounting.recordsProcessed;
    rejected += result.accounting.recordsRejected;
    duplicates += result.accounting.duplicateVehicles;
  }
  // Opening contact, root, parts, makes, one menu and one model; closing
  // contact, makes and the model, whose 21 cards differ from its badge of 20.
  expect(chunks).toBe(5);
  expect(requests).toBe(9);
  expect(processed).toBe(23);
  expect(rejected).toBe(2);
  expect(duplicates).toBe(0);
  expect(vehicles).toHaveLength(21);
  expect(new Set(vehicles.map((v) => v.vin)).size).toBe(21);
  expect(vehicles.some((v) => v.vin === conflict[0])).toBe(false);
  expect(
    native.urls.some(
      (url) => url.includes("/inventory/") || url.includes("/images/"),
    ),
  ).toBe(false);
});

test("Aviation rejects tampered prefix, checksum and foreign native graph before fetching", async () => {
  const native = transport();
  const first = await Effect.runPromise(
    streamAviationInventoryWithRequestGate(
      { maxPages: 4, onBatch: () => Effect.void },
      gate,
    ),
  );
  if (first.cursor.phase === "complete")
    throw new Error("Expected paused directory checkpoint");
  const progress = first.cursor;
  expect(() =>
    AviationCursorSchema.parse({
      ...progress,
      requests: progress.requests + 1,
    }),
  ).toThrow("integrity");
  expect(() =>
    AviationCursor.checkpoint({
      ...progress,
      requests: progress.requests + 1,
    }),
  ).toThrow("request accounting");
  expect(() =>
    AviationCursor.checkpoint({
      ...progress,
      makes: progress.makes.map((m) => ({
        ...m,
        path: "https://example.com/foreign",
      })),
    }),
  ).toThrow("destination");
  const before = native.urls.length;
  await expect(
    Effect.runPromise(
      streamAviationInventoryWithRequestGate(
        {
          startCursor: { ...first.cursor, checksum: "0".repeat(64) },
          onBatch: () => Effect.void,
        },
        gate,
      ),
    ),
  ).rejects.toThrow("integrity");
  expect(native.urls).toHaveLength(before);
});

test("Aviation cursor codec checks UTF-8 wire size before JSON decoding and preserves typed phases", () => {
  expect(
    AviationCursor.parse(AviationCursor.serialize(AviationCursor.initial)),
  ).toEqual(AviationCursor.initial);
  const complete: AviationCursor = {
    source: "aviation",
    version: 1,
    phase: "complete",
  };
  expect(AviationCursor.parse(AviationCursor.serialize(complete))).toEqual(
    complete,
  );
  expect(() =>
    AviationCursor.parse(" ".repeat(AVIATION_MAX_CURSOR_BYTES + 1)),
  ).toThrow("exceeds 4 MiB");
  expect(() =>
    AviationCursor.parse('"' + "é".repeat(AVIATION_MAX_CURSOR_BYTES / 2) + '"'),
  ).toThrow("exceeds 4 MiB");
  expect(() => AviationCursor.parse("{")).toThrow("not valid JSON");
  expect(() =>
    AviationCursor.parse('{"source":"foreign","version":1,"phase":"complete"}'),
  ).toThrow();
});

test("Aviation changed closing make directory fails without emission or an advanced checkpoint", async () => {
  const native = transport();
  const first = await Effect.runPromise(
    streamAviationInventoryWithRequestGate(
      { maxPages: 6, onBatch: () => Effect.void },
      gate,
    ),
  );
  expect(first.status).toBe("paused");
  native.bodies.set(
    AVIATION_MAKES,
    aviationFixtureDirectory([{ ...aviationFixtureMake, count: 999 }], "makes"),
  );
  let callbacks = 0;
  await expect(
    Effect.runPromise(
      streamAviationInventoryWithRequestGate(
        {
          startCursor: first.cursor,
          maxPages: 8,
          onBatch: () =>
            Effect.sync(() => {
              callbacks++;
            }),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("Closing Aviation make directory");
  expect(callbacks).toBe(0);
  expect(first.cursor.phase).not.toBe("complete");
});

test("Aviation first HTTP failure has no retry and complete cursors perform no requests", async () => {
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
      streamAviationInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("503");
  expect(requests).toBe(1);
  const result = await Effect.runPromise(
    streamAviationInventoryWithRequestGate(
      {
        startCursor: { source: "aviation", version: 1, phase: "complete" },
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.pagesProcessed).toBe(0);
  expect(requests).toBe(1);
  await expect(
    Effect.runPromise(
      streamAviationInventoryWithRequestGate(
        { maxPages: 0, onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("budget");
  expect(requests).toBe(1);
});

test("Aviation production soak round-trips every chunk and preserves terminal disjoint accounting", async () => {
  const native = transport();
  let emitted = 0;
  const result = await soakAviationInventory(
    (startCursor, maxPages) =>
      Effect.runPromise(
        streamAviationInventoryWithRequestGate(
          {
            startCursor,
            maxPages,
            onBatch: (vehicles) =>
              Effect.sync(() => {
                emitted += vehicles.length;
              }),
          },
          gate,
        ),
      ),
    20,
    3,
  );
  expect(result.status).toBe("complete");
  expect(result.cursor.phase).toBe("complete");
  expect(result.pagesProcessed).toBe(native.urls.length);
  // The model's 21 cards differ from its badge of 20, so closing re-reads it.
  expect(result.pagesProcessed).toBe(9);
  expect(result.count).toBe(emitted);
  expect(result.count).toBe(21);
  expect(result.accounting).toEqual({
    recordsProcessed: 22,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 1,
  });
});

test("Aviation soak rejects paused presence/accounting and a chunk exceeding its remaining request budget", async () => {
  transport();
  await expect(
    soakAviationInventory(
      async (startCursor, maxPages) => {
        const result = await Effect.runPromise(
          streamAviationInventoryWithRequestGate(
            { startCursor, maxPages, onBatch: () => Effect.void },
            gate,
          ),
        );
        return { ...result, observedVins: [aviationFixtureRecord(1)[0]] };
      },
      20,
      // Four GETs pause the nine-GET run after its first chunk.
      4,
    ),
  ).rejects.toThrow("paused chunk emitted");
  await expect(
    soakAviationInventory(
      async (startCursor, maxPages) =>
        Effect.runPromise(
          streamAviationInventoryWithRequestGate(
            {
              startCursor,
              maxPages: maxPages === 1 ? 2 : maxPages,
              onBatch: () => Effect.void,
            },
            gate,
          ),
        ),
      5,
      4,
    ),
  ).rejects.toThrow("request progress");
});

test("Aviation completes a full crawl when every request waits two minutes for a shared host turn", async () => {
  // Production URG queue on 2026-11-19: about 20 sources shared one lease, so
  // each request waited about two minutes for its turn.
  const native = transport();
  let cursor: AviationCursor = AviationCursor.initial;
  const pages: number[] = [];
  let count = 0;
  while (cursor.phase !== "complete") {
    const chunk = await runWithQueuedHost(
      streamAviationInventory({
        startCursor: cursor,
        maxPages: 8,
        onBatch: () => Effect.void,
      }),
      { turnWaitMs: 2 * 60_000 },
    );
    if (Either.isLeft(chunk.result)) throw chunk.result.left;
    const result: AviationStreamResult = chunk.result.right;
    pages.push(result.pagesProcessed);
    count = result.count;
    cursor = AviationCursorSchema.parse(
      JSON.parse(JSON.stringify(result.cursor)),
    );
    // Every chunk returns its checkpoint and releases each lease in time.
    expect(result.pagesProcessed).toBeGreaterThan(0);
    expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
  }
  // Closing re-reads the model, whose 21 cards differ from its badge of 20.
  expect(pages).toEqual([2, 2, 2, 2, 1]);
  expect(count).toBe(21);
  expect(native.urls).toHaveLength(9);
}, 120_000);

test("Aviation confirms a model read with fewer cards than its badge at closing", async () => {
  const native = transport();
  // The badges promise one more donor than the 21 cards the model page lists.
  const makes = aviationFixtureDirectory(
    [{ ...aviationFixtureMake, count: 22 }],
    "makes",
  );
  native.bodies.set(AVIATION_PARTS, makes);
  native.bodies.set(AVIATION_MAKES, makes);
  native.bodies.set(
    AVIATION_ORIGIN + aviationFixtureMake.path,
    aviationFixtureDirectory(
      [{ ...aviationFixtureModel, count: 22 }],
      "models",
    ),
  );
  const modelUrl = AVIATION_ORIGIN + aviationFixtureModel.path;
  const day = 600;
  const now = () => day * MODEL_CENSUS_DAY_MS;
  const run = async (
    startCursor: AviationCursor,
    previousCursor: unknown,
    runDay: number,
  ) =>
    Effect.runPromise(
      streamAviationInventoryWithRequestGate(
        {
          startCursor,
          previousCursor,
          now: () => runDay * MODEL_CENSUS_DAY_MS,
          maxPages: 8,
          onBatch: () => Effect.void,
        },
        gate,
      ),
    );
  // Opening contact, root, parts, makes, one menu and one model; closing
  // contact and makes, then the short model page once more.
  const paused = await run(AviationCursor.initial, null, day);
  expect(paused.status).toBe("paused");
  expect(paused.pagesProcessed).toBe(8);
  const complete = await run(paused.cursor, null, day);
  expect(complete.status).toBe("complete");
  expect(complete.pagesProcessed).toBe(1);
  expect(native.urls).toHaveLength(9);
  expect(native.urls.filter((url) => url === modelUrl)).toHaveLength(2);
  expect(native.urls.at(-1)).toBe(modelUrl);

  // A carried short page was confirmed on the run that read it and is not
  // re-read at closing.
  const key = JSON.stringify([
    aviationFixtureMake.path,
    aviationFixtureMake.label,
    aviationFixtureModel.path,
    aviationFixtureModel.label,
  ]);
  const carryDay = Array.from({ length: 5 }, (_, i) => day + i + 1).find(
    (d) => ModelCensus.slice(key) !== d % MODEL_CENSUS_SWEEP_DAYS,
  );
  if (carryDay === undefined)
    throw new Error("Expected a day that carries the fixture model");
  const carriedFrom = native.urls.length;
  const carried = await run(AviationCursor.initial, complete.cursor, carryDay);
  expect(carried.status).toBe("complete");
  expect(native.urls.slice(carriedFrom)).not.toContain(modelUrl);
  expect(native.urls.length - carriedFrom).toBe(7);

  // A short page that does not repeat at closing is never accepted.
  const opening = await run(AviationCursor.initial, null, day);
  expect(opening.status).toBe("paused");
  native.bodies.set(
    modelUrl,
    aviationFixtureModelPage(
      Array.from({ length: 20 }, (_, i) => aviationFixtureRecord(i + 1)),
    ),
  );
  let callbacks = 0;
  const before = native.urls.length;
  await expect(
    Effect.runPromise(
      streamAviationInventoryWithRequestGate(
        {
          startCursor: opening.cursor,
          now,
          maxPages: 8,
          onBatch: () =>
            Effect.sync(() => {
              callbacks++;
            }),
          onYards: () =>
            Effect.sync(() => {
              callbacks++;
            }),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("Closing Aviation model list ILX");
  expect(callbacks).toBe(0);
  expect(native.urls.slice(before)).toEqual([modelUrl]);
});
