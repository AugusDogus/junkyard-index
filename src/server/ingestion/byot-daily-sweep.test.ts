import { expect, test } from "bun:test";
import { Effect, TestClock, TestContext } from "effect";
import { streamByotInventory } from "./byot-connector";
import { BYOT_CHUNK_REQUESTS, ByotCursor } from "./byot-cursor";
import {
  BYOT_ARRIVALS_URL,
  BYOT_QUERIES,
  byotSearchUrl,
} from "./byot-directory";
import { BYOT_YARDS } from "./byot-configuration";
import {
  byotFixtureFeeds,
  byotLegacySliceQueries,
  byotMissingF150,
  byotTerminal,
  byotValue,
} from "./byot-test-fixtures";
import type { CanonicalVehicle } from "./types";

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
            if (url === BYOT_ARRIVALS_URL)
              return JSON.stringify(byotFixtureFeeds[code] ?? []);
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
    cursor = result.cursor;
  }
  return { cursor, emitted, searched, requests };
}

test("each daily sweep searches every query at every yard, so a car without photos is listed the day it arrives and removed the day it leaves", async () => {
  // The first daily sweep follows a cursor published by the weekly sweep.
  const legacy = byotTerminal(0, start, undefined, byotLegacySliceQueries);
  const arrived = await runDay(legacy, start + day, (code, index) =>
    code === waco && index === lastQuery ? [byotMissingF150] : [],
  );
  expect(arrived.searched.size).toBe(BYOT_YARDS.length * BYOT_QUERIES.length);
  expect(arrived.requests).toBe(BYOT_YARDS.length * (1 + BYOT_QUERIES.length));
  if (arrived.cursor.phase !== "complete")
    throw new Error("Missing terminal cursor");
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
