import { afterEach, expect, test } from "bun:test";
import { isDurableSourceCursorTerminal } from "./durable-source";
import { validationRejectionKind } from "./ingestion-validation";
import { Effect, Either } from "effect";
import { connectorChunkMetrics } from "./connector-chunk";
import { streamPipesInventoryWithRequestGate } from "./pipes-connector";
import { PipesCursor } from "./pipes-cursor";
import { PIPES_YARD } from "./pipes-yard-metadata";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import {
  pipesTestConfig,
  pipesTestDirections,
  pipesTestInventory,
  pipesTestOwner,
  pipesTestSearch,
} from "./pipes-test-fixtures";
import type { PipesCanonicalVehicle } from "./pipes-transform";
import type { ProviderRequestGate } from "./provider-http-client";
import { soakPipesInventory } from "../../../scripts/soak-pipes";
import { runWithQueuedHost } from "./provider-host-test-support";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const immediate: ProviderRequestGate = (request) => request;
test("Pipes read-only soak completes through actual bounded connector chunks", async () => {
  const requests = replay();
  let callbacks = 0;
  const result = await soakPipesInventory((cursor, maxPages) =>
    Effect.runPromise(
      streamPipesInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages,
          onBatch: () =>
            Effect.sync(() => {
              callbacks++;
            }),
        },
        immediate,
      ),
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.pagesProcessed).toBe(13);
  expect(result.count).toBe(1);
  expect(callbacks).toBe(1);
  expect(requests()).toBe(13);
});
const context = [
  pipesTestOwner,
  pipesTestInventory([]),
  pipesTestDirections,
  pipesTestConfig,
];
// One complete crawl: context, native, query, closing native, two bookends
// and closing context.
const crawl = [
  ...context,
  pipesTestInventory(),
  pipesTestSearch(),
  pipesTestInventory(),
  pipesTestSearch(),
  pipesTestSearch(),
  ...context,
];
function replay(
  change?: (index: number, body: string) => string,
  status = 200,
  bodies: readonly string[] = crawl,
) {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const index = requests++;
      const body = bodies[index];
      if (!body) throw new Error("Unexpected replay request " + index);
      expect(init?.redirect).toBe("manual");
      if (String(input).endsWith("searchVehicleHttp")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          yard_id: "tri_state_iron_metal",
          year_min: null,
          year_max: null,
          make: "FORD",
          model: "FOCUS",
          language: "en",
          location_id: "pipes_shreveport",
        });
      }
      return new Response(change ? change(index, body) : body, {
        status,
        headers: {
          "content-type": body.startsWith("{")
            ? "application/json"
            : "text/html",
        },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return () => requests;
}
for (const budget of [1, 3, 8])
  test(
    "Pipes sums terminal-only metrics through real codec at budget " + budget,
    async () => {
      const requests = replay();
      let cursor = PipesCursor.initial,
        callbacks = 0,
        yards = 0;
      const metrics = {
        vehiclesProcessed: 0,
        uniqueVehicles: 0,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
      };
      const emitted: PipesCanonicalVehicle[] = [];
      for (let chunks = 0; chunks < 20; chunks++) {
        const result = await Effect.runPromise(
          streamPipesInventoryWithRequestGate(
            {
              startCursor: cursor,
              maxPages: budget,
              onBatch: (vehicles) =>
                Effect.sync(() => {
                  callbacks++;
                  emitted.push(...vehicles);
                }),
              onYards: () =>
                Effect.sync(() => {
                  yards++;
                }),
            },
            immediate,
          ),
        );
        const delta = connectorChunkMetrics(result, result.count);
        metrics.vehiclesProcessed += delta.vehiclesProcessed;
        metrics.uniqueVehicles += delta.uniqueVehicles;
        metrics.duplicateVehicles += delta.duplicateVehicles;
        metrics.rejectedVehicles += delta.rejectedVehicles;
        const wire = serializeDurableSourceCursor(result.cursor);
        expect(JSON.parse(wire)).not.toHaveProperty("source");
        cursor = parseDurableSourceCursor("pipes", wire);
        if (result.status === "complete") break;
        expect(result.count).toBe(0);
        expect(result.observedVins).toEqual([]);
        expect(result.accounting).toEqual({
          recordsProcessed: 0,
          recordsExcluded: 0,
          recordsRejected: 0,
          duplicateVehicles: 0,
        });
        expect(callbacks).toBe(0);
        expect(yards).toBe(0);
      }
      expect(cursor.phase).toBe("complete");
      expect(requests()).toBe(13);
      expect(
        isDurableSourceCursorTerminal(
          "pipes",
          serializeDurableSourceCursor(cursor),
        ),
      ).toBe(true);
      expect(callbacks).toBe(1);
      expect(yards).toBe(1);
      expect(emitted).toHaveLength(1);
      expect(metrics).toEqual({
        vehiclesProcessed: 1,
        uniqueVehicles: 1,
        duplicateVehicles: 0,
        rejectedVehicles: 0,
      });
      const repeated = await Effect.runPromise(
        streamPipesInventoryWithRequestGate(
          {
            startCursor: cursor,
            onBatch: () =>
              Effect.sync(() => {
                callbacks++;
              }),
          },
          immediate,
        ),
      );
      expect(repeated.count).toBe(0);
      expect(callbacks).toBe(1);
      expect(requests()).toBe(13);
    },
  );
async function runToEnd(batches = { count: 0 }) {
  let cursor = PipesCursor.initial;
  for (let chunks = 0; chunks < 20; chunks++) {
    const result = await Effect.runPromise(
      streamPipesInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 8,
          onBatch: () =>
            Effect.sync(() => {
              batches.count++;
            }),
        },
        immediate,
      ),
    );
    cursor = PipesCursor.parse(PipesCursor.serialize(result.cursor));
    if (result.status === "complete")
      return { result, callbacks: batches.count };
  }
  throw new Error("Pipes replay did not complete within 20 chunks");
}
test("Pipes accepts a bookend whose only change is the nightly daysInYard stamp", async () => {
  // Production run 803fe455 on 2026-11-22: the nightly VinPlus publish
  // rewrote daysInYard between the first query and its bookend re-read.
  const requests = replay((index, body) =>
    index === 7 ? body.replace('"daysInYard":7', '"daysInYard":8') : body,
  );
  const { result, callbacks } = await runToEnd();
  expect(result.count).toBe(1);
  expect(result.cursor.restarts).toBe(0);
  expect(callbacks).toBe(1);
  expect(requests()).toBe(13);
});
test("Pipes restarts from the opening controls when a bookend record really changed", async () => {
  const requests = replay(
    (index, body) =>
      index === 7
        ? body.replace('"vehicleRow":"12"', '"vehicleRow":"13"')
        : body,
    200,
    [...crawl.slice(0, 8), ...crawl],
  );
  const { result, callbacks } = await runToEnd();
  expect(result.count).toBe(1);
  expect(result.cursor.restarts).toBe(1);
  expect(result.warnings).toEqual([
    expect.stringContaining("restarted 1 time"),
  ]);
  expect(callbacks).toBe(1);
  expect(requests()).toBe(21);
});
test("Pipes restarts from the opening controls when the closing native census changed", async () => {
  // Production run 6f920075 on 2026-11-21: the nightly VinPlus publish
  // removed vehicles between the opening and closing native census.
  const requests = replay(
    (index, body) => (index === 6 ? pipesTestInventory([]) : body),
    200,
    [...crawl.slice(0, 7), ...crawl],
  );
  const { result, callbacks } = await runToEnd();
  expect(result.count).toBe(1);
  expect(result.cursor.restarts).toBe(1);
  expect(callbacks).toBe(1);
  expect(requests()).toBe(20);
});
test("Pipes restarts from the opening controls when the make directory changed during the opening census", async () => {
  const requests = replay(
    (index, body) =>
      index === 4 ? pipesTestInventory(undefined, ["CHEVROLET", "FORD"]) : body,
    200,
    [...crawl.slice(0, 5), ...crawl],
  );
  const { result, callbacks } = await runToEnd();
  expect(result.count).toBe(1);
  expect(result.cursor.restarts).toBe(1);
  expect(callbacks).toBe(1);
  expect(requests()).toBe(18);
});
test("Pipes rejects without callbacks when the source keeps changing after its restarts", async () => {
  const attempt = crawl.slice(0, 7);
  const requests = replay(
    (index, body) => (index % 7 === 6 ? pipesTestInventory([]) : body),
    200,
    [...attempt, ...attempt, ...attempt],
  );
  const batches = { count: 0 };
  const rejection: unknown = await runToEnd(batches).catch(
    (error: unknown) => error,
  );
  const thrown = () => {
    throw rejection;
  };
  expect(thrown).toThrow("after 2 in-run restarts");
  expect(thrown).toThrow("Closing native census for FORD");
  // The source kept changing, so a crawl later today can pass once it settles.
  expect(validationRejectionKind(rejection)).toBe("transient");
  expect(batches.count).toBe(0);
  expect(requests()).toBe(21);
});
test("Pipes rejects partial HTTP controls and sibling source cursors", async () => {
  replay(undefined, 206);
  await expect(
    Effect.runPromise(
      streamPipesInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        immediate,
      ),
    ),
  ).rejects.toThrow("HTTP 200");
  const wire = JSON.parse(PipesCursor.serialize(PipesCursor.initial));
  expect(() =>
    PipesCursor.parse(JSON.stringify({ ...wire, source: "littleton" })),
  ).toThrow("omit");
  expect(() => PipesCursor.parse(" ".repeat(1024 * 1024 + 1))).toThrow(
    "before JSON",
  );
});
test("Pipes rejects forged phase, checksum and stored optional field changes", async () => {
  replay();
  const result = await Effect.runPromise(
    streamPipesInventoryWithRequestGate(
      { maxPages: 6, onBatch: () => Effect.void },
      immediate,
    ),
  );
  const wire = PipesCursor.serialize(result.cursor);
  expect(() =>
    PipesCursor.parse(
      wire.replace('"phase":"closing-native"', '"phase":"complete"'),
    ),
  ).toThrow();
  expect(() =>
    PipesCursor.parse(wire.replace('daysInYard\\\":7', 'daysInYard\\\":8')),
  ).toThrow("checksum");
});
test("Pipes callback failure cannot return an advanced terminal checkpoint", async () => {
  replay();
  const first = await Effect.runPromise(
    streamPipesInventoryWithRequestGate(
      { maxPages: 8, onBatch: () => Effect.void },
      immediate,
    ),
  );
  const saved = PipesCursor.serialize(first.cursor);
  await expect(
    Effect.runPromise(
      streamPipesInventoryWithRequestGate(
        {
          startCursor: first.cursor,
          maxPages: 8,
          onBatch: () => Effect.fail(new Error("snapshot write failed")),
        },
        immediate,
      ),
    ),
  ).rejects.toThrow("snapshot write failed");
  expect(PipesCursor.serialize(first.cursor)).toBe(saved);
});
test("Pipes fails without returning a paused checkpoint when no control fits the remaining time", async () => {
  const now = Date.now;
  let reads = 0,
    gateCalls = 0;
  try {
    // Every clock read advances past the full chunk budget, independently of
    // scheduler reads and stack-frame formatting in a warmed test process.
    Date.now = () => reads++ * 180_000;
    await expect(
      Effect.runPromise(
        streamPipesInventoryWithRequestGate(
          { maxPages: 1, onBatch: () => Effect.void },
          (request) => {
            gateCalls++;
            return request;
          },
        ),
      ),
    ).rejects.toThrow("No control completed");
    expect(gateCalls).toBe(0);
  } finally {
    Date.now = now;
  }
});
test("Pipes callback mutation cannot change returned metrics or future yard metadata", async () => {
  replay();
  const first = await Effect.runPromise(
    streamPipesInventoryWithRequestGate(
      { maxPages: 8, onBatch: () => Effect.void },
      immediate,
    ),
  );
  const result = await Effect.runPromise(
    streamPipesInventoryWithRequestGate(
      {
        startCursor: first.cursor,
        maxPages: 8,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            vehicles.length = 0;
          }),
        onYards: (yards) =>
          Effect.sync(() => {
            Object.assign(yards[0] ?? {}, {
              lat: 0,
              name: "Mutated callback copy",
            });
            yards.length = 0;
          }),
      },
      immediate,
    ),
  );
  expect(result.count).toBe(1);
  expect(result.accounting).toEqual({
    recordsProcessed: 1,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(PIPES_YARD.lat).toBe(32.5299208);
  expect(PIPES_YARD.name).toBe("Pipes U-Pull-It");
});

test("Pipes keeps advancing when every VinPlus request waits minutes for a shared host turn", async () => {
  // Production VinPlus queue on 2026-11-19: about 20 sources shared one lease,
  // so each config, search and bookend waited about 150 s for its turn.
  const requests = replay();
  let cursor = PipesCursor.initial;
  const pages: number[] = [];
  let count = 0;
  while (cursor.phase !== "complete") {
    const chunk = await runWithQueuedHost(
      streamPipesInventoryWithRequestGate(
        { startCursor: cursor, maxPages: 8, onBatch: () => Effect.void },
        immediate,
      ),
      { turnWaitMs: 150_000 },
    );
    if (Either.isLeft(chunk.result)) throw chunk.result.left;
    pages.push(chunk.result.right.pagesProcessed);
    count = chunk.result.right.count;
    cursor = chunk.result.right.cursor;
    // Every chunk returns its checkpoint and releases each lease in time.
    expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
  }
  expect(pages).toEqual([7, 5, 1]);
  expect(count).toBe(1);
  expect(requests()).toBe(13);
}, 120_000);
