import { describe, expect, test } from "bun:test";
import {
  isDurableSourceCursorTerminal,
  serializeDurableSourceCursor,
} from "./durable-source";
import { Effect } from "effect";
import { streamByotInventory } from "./byot-connector";
import {
  ByotCursor,
  BYOT_CHUNK_REQUESTS,
  BYOT_MAX_RUN_MS,
  BYOT_RUN_REQUESTS,
  byotHash,
  byotQueryKey,
  BYOT_RETIRED_QUERY_MAX_AGE_MS,
  type ByotCache,
} from "./byot-cursor";
import { BYOT_QUERIES, BYOT_ARRIVALS_URL } from "./byot-directory";
import { BYOT_YARDS } from "./byot-configuration";
import {
  byotFixtureFeeds,
  byotLegacySliceQueries,
  byotValue,
  byotMissingF150,
  byotTerminal as terminal,
} from "./byot-test-fixtures";
import { byotSnapshot } from "./byot-snapshot";
import { ByotResult } from "./byot-result";
import type { CanonicalVehicle } from "./types";
const now = Date.UTC(2026, 10, 15);

describe("BYOT bounded durable daily sweep", () => {
  test("reads every yard feed once, resumes wire checkpoints, and finishes exactly one daily sweep", async () => {
    const requests: { url: string; code: string }[] = [];
    const emitted: CanonicalVehicle[] = [];
    let cursor = ByotCursor.initial();
    let total = 0;
    while (cursor.phase !== "complete") {
      const result = await Effect.runPromise(
        streamByotInventory({
          startCursor: cursor,
          now,
          readPage: (url, code) =>
            Effect.sync(() => {
              requests.push({ url, code });
              if (url === BYOT_ARRIVALS_URL)
                return JSON.stringify(byotFixtureFeeds[code]);
              return JSON.stringify({
                search_id: null,
                data: { availableVehicles: [], compatibleVehicles: [] },
              });
            }),
          onBatch: (batch) =>
            Effect.sync(() => emitted.push(...batch)).pipe(Effect.asVoid),
        }),
      );
      expect(result.pagesProcessed).toBeLessThanOrEqual(BYOT_CHUNK_REQUESTS);
      total += result.pagesProcessed;
      cursor = byotValue(
        ByotCursor.fromWire(byotValue(ByotCursor.serialize(result.cursor))),
      );
    }
    expect(total).toBe(BYOT_RUN_REQUESTS);
    expect(
      requests
        .filter((request) => request.url === BYOT_ARRIVALS_URL)
        .map((request) => request.code),
    ).toEqual(BYOT_YARDS.map((yard) => yard.code));
    expect(cursor.nextOffset).toBe(0);
    expect(
      isDurableSourceCursorTerminal(
        "byot",
        serializeDurableSourceCursor(cursor),
      ),
    ).toBe(true);
    expect(emitted.length).toBeGreaterThan(5000);
    for (const yard of cursor.cache)
      expect(yard).toHaveLength(BYOT_QUERIES.length);
    // Replays a full day for five yards (about 105 checkpoint round trips).
  }, 180_000);
  test("the next daily sweep starts where the published one ended, including a weekly-slice cursor", () => {
    const legacy = terminal(0, now, undefined, byotLegacySliceQueries);
    expect(byotValue(ByotCursor.begin(legacy, now + 86400000))).toMatchObject({
      phase: "arrivals",
      sweepStart: byotLegacySliceQueries,
    });
    const begin = byotValue(ByotCursor.begin(terminal(0), now + 86400000));
    expect(begin).toMatchObject({ phase: "arrivals", sweepStart: 0 });
    if (begin.phase !== "arrivals") throw new Error("Missing daily cursor");
    expect(begin.cache[0]).toHaveLength(BYOT_QUERIES.length);
  });
  test("active queries survive long outages, failed evidence never seeds progress, tampering and forged completion fail", () => {
    const previous = terminal(0);
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
    const begin = byotValue(ByotCursor.begin(terminal(0), now + 86400000));
    if (begin.phase !== "arrivals") throw new Error("Missing daily cursor");
    const current = terminal(begin.sweepStart, begin.startedAt, begin.cache);
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
  let previous = terminal(0);
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
  const swept = terminal(begin.sweepStart, begin.startedAt, begin.cache);
  if (swept.phase !== "complete") throw new Error("Missing terminal cursor");
  expect(listed(swept.cache)).toBe(false);
});

test("only retired queries expire after 21 days, while directory changes preserve matching buckets", () => {
  const prior = terminal(0);
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
