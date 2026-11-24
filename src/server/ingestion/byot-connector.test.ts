import { describe, expect, test } from "bun:test";
import { Effect, TestClock, TestContext } from "effect";
import { streamByotInventory } from "./byot-connector";
import {
  BYOT_CHUNK_REQUESTS,
  BYOT_MAX_RUN_MS,
  BYOT_RETIRED_QUERY_MAX_AGE_MS,
  BYOT_RUN_REQUESTS,
  ByotCursor,
  byotHash,
  byotQueryKey,
  type ByotCache,
} from "./byot-cursor";
import {
  BYOT_ARRIVALS_URL,
  BYOT_QUERIES,
  byotSearchUrl,
} from "./byot-directory";
import { BYOT_YARDS } from "./byot-configuration";
import {
  DURABLE_SOURCE_DEFINITIONS,
  isDurableSourceCursorTerminal,
  serializeDurableSourceCursor,
} from "./durable-source";
import {
  byotFixtureFeeds,
  byotLegacySliceQueries,
  byotMissingF150,
  byotTerminal,
  byotValue,
} from "./byot-test-fixtures";
import { byotSnapshot } from "./byot-snapshot";
import { ByotResult } from "./byot-result";
import type { CanonicalVehicle } from "./types";
const now = Date.UTC(2026, 10, 15);

describe("BYOT bounded durable daily sweep", () => {
  test("the next daily sweep starts where the published one ended, including a weekly-slice cursor", () => {
    const legacy = byotTerminal(0, now, undefined, byotLegacySliceQueries);
    expect(byotValue(ByotCursor.begin(legacy, now + 86400000))).toMatchObject({
      phase: "arrivals",
      sweepStart: byotLegacySliceQueries,
    });
    const begin = byotValue(ByotCursor.begin(byotTerminal(0), now + 86400000));
    expect(begin).toMatchObject({ phase: "arrivals", sweepStart: 0 });
    if (begin.phase !== "arrivals") throw new Error("Missing daily cursor");
    expect(begin.cache[0]).toHaveLength(BYOT_QUERIES.length);
  });
  test("active queries survive long outages, failed evidence never seeds progress, tampering and forged completion fail", () => {
    const previous = byotTerminal(0);
    const begin = byotValue(ByotCursor.begin(previous, now + 30 * 86400000));
    if (begin.phase !== "arrivals" || previous.phase !== "complete")
      throw new Error("Missing sweep fixture");
    expect(begin.cache).toEqual(previous.cache);
    expect(ByotCursor.begin(begin, now).ok).toBe(false);
    expect(ByotCursor.parse({ ...previous, nextOffset: 1 }).ok).toBe(false);
    const forged = {
      ...previous,
      phase: "complete",
      cache: [[], [], [], [], []],
    };
    expect(
      ByotCursor.parse({
        ...forged,
        checksum: byotHash({ ...forged, checksum: undefined }),
      }).ok,
    ).toBe(false);
    expect(ByotCursor.fromWire("x".repeat(16 * 1024 * 1024 + 1)).ok).toBe(
      false,
    );
  });
  test("a failed request publishes nothing and leaves the caller's input checkpoint intact", async () => {
    const initial = ByotCursor.initial();
    let calls = 0,
      emitted = false;
    const result = await Effect.runPromise(
      Effect.either(
        streamByotInventory({
          startCursor: initial,
          now,
          readPage: () => {
            calls++;
            return Effect.fail(
              ByotResult.error("fixture", "HTTP429 Retry-After: 60"),
            );
          },
          onBatch: () =>
            Effect.sync(() => {
              emitted = true;
            }),
        }),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(calls).toBe(1);
    expect(emitted).toBe(false);
    expect(initial).toEqual(ByotCursor.initial());
  });
  test("a resumed ready checkpoint publishes today's unphotographed donor without requests", async () => {
    const begin = byotValue(ByotCursor.begin(byotTerminal(0), now + 86400000));
    if (begin.phase !== "arrivals") throw new Error("Missing daily cursor");
    const current = byotTerminal(
      begin.sweepStart,
      begin.startedAt,
      begin.cache,
    );
    if (current.phase !== "complete") throw new Error("Missing current cursor");
    const first = current.cache[0]?.[0];
    if (!first) throw new Error("Missing bucket");
    first.records = [byotMissingF150];
    const ready = byotValue(
      ByotCursor.checkpoint({
        ...begin,
        phase: "ready",
        cache: current.cache,
        feeds: BYOT_YARDS.map((yard) => byotFixtureFeeds[yard.code] ?? []),
      }),
    );
    const vehicles: CanonicalVehicle[] = [];
    const result = await Effect.runPromise(
      streamByotInventory({
        startCursor: ready,
        now: now + 86400000,
        readPage: () =>
          Effect.fail(ByotResult.error("test", "Unexpected request")),
        onBatch: (batch) =>
          Effect.sync(() => vehicles.push(...batch)).pipe(Effect.asVoid),
      }),
    );
    expect(result.status).toBe("complete");
    expect(result.pagesProcessed).toBe(0);
    expect(
      vehicles.some((vehicle) => vehicle.stockNumber === "STK044158"),
    ).toBe(true);
  });
});

test("BYOT stops an overdue resumed daily run before dispatch or emission", async () => {
  const start = byotValue(ByotCursor.begin(null, now));
  let calls = 0;
  const result = await Effect.runPromise(
    Effect.either(
      streamByotInventory({
        startCursor: start,
        now: now + BYOT_MAX_RUN_MS + 1,
        readPage: () => {
          calls++;
          return Effect.succeed("[]");
        },
        onBatch: () =>
          Effect.fail(ByotResult.error("test", "Unexpected emission")),
      }),
    ),
  );
  expect(result._tag).toBe("Left");
  expect(calls).toBe(0);
});

test("missed days keep unphotographed stock until the next daily sweep re-checks it", () => {
  let previous = byotTerminal(0);
  if (previous.phase !== "complete") throw new Error("Missing terminal cursor");
  const seeded = previous.cache[0]?.find(
    (entry) => entry.query === byotQueryKey(100),
  );
  if (!seeded) throw new Error("Missing bucket");
  seeded.records = [byotMissingF150];
  previous = byotValue(ByotCursor.checkpoint(previous));
  const feeds = BYOT_YARDS.map((yard) => byotFixtureFeeds[yard.code] ?? []);
  const listed = (cache: ByotCache) =>
    byotSnapshot(feeds, cache).vehicles.some(
      (row) => row.stockNumber === byotMissingF150.StockId,
    );
  const begin = byotValue(ByotCursor.begin(previous, now + 4 * 86400000));
  if (begin.phase !== "arrivals") throw new Error("Missing daily cursor");
  expect(listed(begin.cache)).toBe(true);
  const swept = byotTerminal(begin.sweepStart, begin.startedAt, begin.cache);
  if (swept.phase !== "complete") throw new Error("Missing terminal cursor");
  expect(listed(swept.cache)).toBe(false);
});

test("only retired queries expire after 21 days, while directory changes preserve matching buckets", () => {
  const prior = byotTerminal(0);
  if (prior.phase !== "complete") throw new Error("Missing terminal cursor");
  const retired = byotHash({ make: "REMOVED", model: "QUERY" });
  const directory = [...prior.directory, retired];
  const previous = byotValue(
    ByotCursor.checkpoint({
      ...prior,
      directory,
      scope: byotHash({ yards: BYOT_YARDS, queries: directory }),
      cache: prior.cache.map((yard) => [
        ...yard,
        { query: retired, checkedAt: now, records: [byotMissingF150] },
      ]),
    }),
  );
  const retained = byotValue(
    ByotCursor.begin(previous, now + BYOT_RETIRED_QUERY_MAX_AGE_MS),
  );
  const expired = byotValue(
    ByotCursor.begin(previous, now + BYOT_RETIRED_QUERY_MAX_AGE_MS + 1),
  );
  if (retained.phase !== "arrivals" || expired.phase !== "arrivals")
    throw new Error("Missing daily cursor");
  expect(retained.sweepStart).toBe(0);
  expect(retained.cache[0]?.some((entry) => entry.query === retired)).toBe(
    true,
  );
  expect(expired.cache[0]?.some((entry) => entry.query === retired)).toBe(
    false,
  );
  expect(expired.cache).toEqual(prior.cache);
  expect(
    ByotCursor.parse({
      ...retained,
      scope: previous.scope,
      directory: previous.directory,
      checksum: byotHash({
        ...retained,
        scope: previous.scope,
        directory: previous.directory,
        checksum: undefined,
      }),
    }).ok,
  ).toBe(false);
});

const day = 86_400_000;
const start = Date.UTC(2026, 10, 15);
const empty = JSON.stringify({
  search_id: null,
  data: { availableVehicles: [], compatibleVehicles: [] },
});
const lastQuery = BYOT_QUERIES.length - 1;
const waco = BYOT_YARDS[0].code;

/** Runs one daily BYOT publication through every chunk. `searchFor` returns
 * the available vehicles a yard's native search lists for a query. */
async function runDay(
  previous: ByotCursor | null,
  now: number,
  searchFor: (code: string, index: number) => unknown[],
) {
  const emitted: CanonicalVehicle[] = [];
  const searched = new Set<string>();
  const feeds: string[] = [];
  const urls = new Map(
    BYOT_YARDS.flatMap((yard) =>
      BYOT_QUERIES.map(
        (_, index) => [byotSearchUrl(yard.code, index), index] as const,
      ),
    ),
  );
  let cursor = ByotCursor.initial();
  let requests = 0;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamByotInventory({
        startCursor: cursor,
        previousCursor: previous,
        now,
        maxPages: BYOT_CHUNK_REQUESTS,
        readPage: (url, code) =>
          Effect.sync(() => {
            requests++;
            if (url === BYOT_ARRIVALS_URL) {
              feeds.push(code);
              return JSON.stringify(byotFixtureFeeds[code] ?? []);
            }
            const index = urls.get(url);
            if (index === undefined) throw new Error("Unexpected URL " + url);
            searched.add(`${code}:${index}`);
            return JSON.stringify({
              search_id: null,
              data: {
                availableVehicles: searchFor(code, index),
                compatibleVehicles: [],
              },
            });
          }),
        onBatch: (batch) =>
          Effect.sync(() => emitted.push(...batch)).pipe(Effect.asVoid),
      }),
    );
    if (result.status === "paused" && result.pagesProcessed === 0)
      throw new Error("BYOT chunk made no progress");
    expect(result.pagesProcessed).toBeLessThanOrEqual(BYOT_CHUNK_REQUESTS);
    // Each chunk resumes from its checkpoint's wire form.
    cursor = byotValue(
      ByotCursor.fromWire(byotValue(ByotCursor.serialize(result.cursor))),
    );
  }
  return { cursor, emitted, searched, feeds, requests };
}

test("each daily sweep searches every query at every yard, so a car without photos is listed the day it arrives and removed the day it leaves", async () => {
  // The first daily sweep follows a cursor published by the weekly sweep.
  const legacy = byotTerminal(0, start, undefined, byotLegacySliceQueries);
  const arrived = await runDay(legacy, start + day, (code, index) =>
    code === waco && index === lastQuery ? [byotMissingF150] : [],
  );
  expect(arrived.searched.size).toBe(BYOT_YARDS.length * BYOT_QUERIES.length);
  expect(arrived.requests).toBe(BYOT_RUN_REQUESTS);
  expect(arrived.feeds).toEqual(BYOT_YARDS.map((yard) => yard.code));
  if (arrived.cursor.phase !== "complete")
    throw new Error("Missing terminal cursor");
  // A full sweep ends where it began.
  expect(arrived.cursor.nextOffset).toBe(byotLegacySliceQueries);
  expect(
    isDurableSourceCursorTerminal(
      "byot",
      serializeDurableSourceCursor(arrived.cursor),
    ),
  ).toBe(true);
  expect(arrived.emitted.length).toBeGreaterThan(5000);
  for (const yard of arrived.cursor.cache)
    expect(
      yard.filter((entry) => entry.checkedAt === start + day),
    ).toHaveLength(BYOT_QUERIES.length);
  expect(
    arrived.emitted.some(
      (vehicle) => vehicle.stockNumber === byotMissingF150.StockId,
    ),
  ).toBe(true);
  const left = await runDay(arrived.cursor, start + 2 * day, () => []);
  expect(
    left.emitted.some(
      (vehicle) => vehicle.stockNumber === byotMissingF150.StockId,
    ),
  ).toBe(false);
}, 120_000);

test("a chunk stops starting requests while one more could overrun its deadline", async () => {
  const begin = byotValue(ByotCursor.begin(null, start));
  const result = await Effect.runPromise(
    streamByotInventory({
      startCursor: begin,
      now: start,
      maxPages: BYOT_CHUNK_REQUESTS,
      // Each request takes three seconds, including its pacing gap.
      readPage: (url, code) =>
        TestClock.adjust("3 seconds").pipe(
          Effect.as(
            url === BYOT_ARRIVALS_URL
              ? JSON.stringify(byotFixtureFeeds[code] ?? [])
              : empty,
          ),
        ),
      onBatch: () => Effect.void,
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  // Requests start every 3 s. The 58th starts at 171 s, the last start that
  // leaves 47 s for the request and its gap and 20 s for the snapshot
  // inside the four-minute chunk.
  expect(result.status).toBe("paused");
  expect(result.pagesProcessed).toBe(58);
  expect(result.cursor.phase).toBe("search");
});

test("after a request succeeds, a failed one ends the chunk with the work before it, and the next chunk fails on it", async () => {
  let calls = 0;
  const failing =
    (fail: (call: number) => boolean) => (_url: string, code: string) =>
      Effect.suspend(() =>
        fail(++calls)
          ? Effect.fail(ByotResult.error("fixture", "HTTP429 Retry-After: 60"))
          : Effect.succeed(JSON.stringify(byotFixtureFeeds[code] ?? [])),
      );
  const partial = await Effect.runPromise(
    streamByotInventory({
      startCursor: ByotCursor.initial(),
      now: start,
      maxPages: BYOT_CHUNK_REQUESTS,
      readPage: failing((call) => call === 5),
      onBatch: () => Effect.void,
    }),
  );
  expect(partial.status).toBe("paused");
  expect(partial.pagesProcessed).toBe(4);
  expect(partial.cursor).toMatchObject({ phase: "arrivals" });
  if (partial.cursor.phase !== "arrivals") throw new Error("Missing cursor");
  expect(partial.cursor.feeds).toHaveLength(4);
  const retried = await Effect.runPromise(
    Effect.either(
      streamByotInventory({
        startCursor: partial.cursor,
        now: start,
        readPage: failing(() => true),
        onBatch: () => Effect.void,
      }),
    ),
  );
  expect(retried._tag).toBe("Left");
  expect(calls).toBe(6);
});

test("checkpoints without the required search evidence are rejected", () => {
  const legacy = byotTerminal(0, start, undefined, byotLegacySliceQueries);
  if (legacy.phase !== "complete") throw new Error("Missing terminal cursor");
  const shifted = { ...legacy, nextOffset: legacy.nextOffset + 1 };
  expect(
    ByotCursor.parse({
      ...shifted,
      checksum: byotHash({ ...shifted, checksum: undefined }),
    }).ok,
  ).toBe(false);
  const begin = byotValue(ByotCursor.begin(null, start + day));
  if (begin.phase !== "arrivals") throw new Error("Missing daily cursor");
  const weekly = byotTerminal(
    0,
    begin.startedAt,
    undefined,
    byotLegacySliceQueries,
  );
  if (weekly.phase !== "complete") throw new Error("Missing terminal cursor");
  const ready = ByotCursor.checkpoint({
    ...begin,
    phase: "ready",
    feeds: BYOT_YARDS.map((yard) => byotFixtureFeeds[yard.code] ?? []),
    cache: weekly.cache,
  });
  expect(ready.ok).toBe(false);
  if (!ready.ok)
    expect(ready.error.message).toContain("contiguous search evidence");
});

test("the durable source sends BYOT's full chunk request cap", () => {
  expect(DURABLE_SOURCE_DEFINITIONS.byot.maxPagesPerChunk).toBe(
    BYOT_CHUNK_REQUESTS,
  );
});
