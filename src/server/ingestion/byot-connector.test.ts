import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamByotInventory } from "./byot-connector";
import {
  ByotCursor,
  BYOT_RUN_REQUESTS,
  byotHash,
  byotQueryKey,
  BYOT_RETIRED_QUERY_MAX_AGE_MS,
} from "./byot-cursor";
import {
  BYOT_DAILY_QUERIES,
  BYOT_QUERIES,
  BYOT_ARRIVALS_URL,
} from "./byot-directory";
import { BYOT_YARDS } from "./byot-configuration";
import {
  byotFixtureFeeds,
  byotValue,
  byotMissingF150,
  byotTerminal as terminal,
} from "./byot-test-fixtures";
import { byotSnapshot } from "./byot-snapshot";
import { ByotResult } from "./byot-result";
import type { CanonicalVehicle } from "./types";
const now = Date.UTC(2026, 10, 15);

describe("BYOT bounded durable daily slice", () => {
  test("reads every yard feed once, resumes wire checkpoints, and finishes exactly one daily slice", async () => {
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
      expect(result.pagesProcessed).toBeLessThanOrEqual(8);
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
    expect(cursor.nextOffset).toBe(BYOT_DAILY_QUERIES);
    expect(emitted.length).toBeGreaterThan(5000);
    for (const yard of cursor.cache)
      expect(yard).toHaveLength(BYOT_DAILY_QUERIES);
    // Replays a full day for five yards (about 120 checkpoint round trips),
    // which takes about 18 seconds on CI runners.
  }, 60_000);
  test("seven daily published cursors cover every query and preserve unrevisited unphotographed vehicles", () => {
    let previous: ByotCursor | null = null;
    const indexes = new Set<number>();
    for (let day = 0; day < 7; day++) {
      const begin = byotValue(ByotCursor.begin(previous, now + day * 86400000));
      if (begin.phase !== "arrivals") throw new Error("Missing daily start");
      const completed = terminal(
        begin.sweepStart,
        begin.startedAt,
        begin.cache,
      );
      if (completed.phase !== "complete")
        throw new Error("Missing terminal fixture");
      for (let i = 0; i < BYOT_DAILY_QUERIES; i++)
        indexes.add((begin.sweepStart + i) % BYOT_QUERIES.length);
      previous = completed;
    }
    expect(indexes.size).toBe(BYOT_QUERIES.length);
    const begin = byotValue(ByotCursor.begin(terminal(0), now + 86400000));
    expect(begin).toMatchObject({
      phase: "arrivals",
      sweepStart: BYOT_DAILY_QUERIES,
    });
    if (begin.phase !== "arrivals") throw new Error("Missing daily cursor");
    expect(begin.cache[0]).toHaveLength(BYOT_DAILY_QUERIES);
  });
  test("active queries survive long outages, failed evidence never seeds progress, tampering and forged completion fail", () => {
    const previous = terminal(0);
    const begin = byotValue(ByotCursor.begin(previous, now + 30 * 86400000));
    if (begin.phase !== "arrivals" || previous.phase !== "complete")
      throw new Error("Missing sweep fixture");
    expect(begin.cache).toEqual(previous.cache);
    expect(ByotCursor.begin(begin, now).ok).toBe(false);
    expect(ByotCursor.parse({ ...previous, nextOffset: 0 }).ok).toBe(false);
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
  test("a ready checkpoint retains an unphotographed donor found on an earlier day", async () => {
    const prior = terminal(0);
    if (prior.phase !== "complete") throw new Error("Missing terminal cursor");
    const first = prior.cache[0]?.[0];
    if (!first) throw new Error("Missing bucket");
    first.records = [byotMissingF150];
    const begin = byotValue(
      ByotCursor.begin(byotValue(ByotCursor.checkpoint(prior)), now + 86400000),
    );
    if (begin.phase !== "arrivals") throw new Error("Missing daily cursor");
    const current = terminal(begin.sweepStart, begin.startedAt, begin.cache);
    if (current.phase !== "complete") throw new Error("Missing current cursor");
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
        now: now + 2 * 60 * 60 * 1000 + 1,
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

test("a three-day outage retains unphotographed stock until its own sweep slice re-runs", () => {
  let previous = terminal(0);
  if (previous.phase !== "complete") throw new Error("Missing terminal cursor");
  const seeded = previous.cache[0]?.find(
    (entry) => entry.query === byotQueryKey(100),
  );
  if (!seeded) throw new Error("Missing bucket");
  seeded.records = [byotMissingF150];
  previous = byotValue(ByotCursor.checkpoint(previous));
  for (const day of [1, 2, 3, 4, 5, 9, 10]) {
    const begin = byotValue(ByotCursor.begin(previous, now + day * 86400000));
    if (begin.phase !== "arrivals") throw new Error("Missing daily cursor");
    expect(
      byotSnapshot(
        BYOT_YARDS.map((yard) => byotFixtureFeeds[yard.code] ?? []),
        begin.cache,
      ).vehicles.some((row) => row.stockNumber === byotMissingF150.StockId),
    ).toBe(true);
    previous = terminal(begin.sweepStart, begin.startedAt, begin.cache);
    if (previous.phase !== "complete")
      throw new Error("Missing terminal cursor");
    const snapshot = byotSnapshot(
      BYOT_YARDS.map((yard) => byotFixtureFeeds[yard.code] ?? []),
      previous.cache,
      previous.yardCounts,
    );
    expect(snapshot.validation.ok).toBe(true);
    expect(
      snapshot.vehicles.some(
        (row) => row.stockNumber === byotMissingF150.StockId,
      ),
    ).toBe(day !== 10);
  }
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
