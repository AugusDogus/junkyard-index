import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import { BYOT_QUERIES, byotSearchUrl } from "./byot-directory";
import { parseByotResponse } from "./byot-parser";
import { ByotCursor, BYOT_MAX_CURSOR_BYTES, byotQueryKey } from "./byot-cursor";
import { byotSnapshot } from "./byot-snapshot";
import { byotFeeds, byotValue, byotTerminal } from "./byot-test-fixtures";

const ReceiptSchema = z.object({
  url: z.string().url(),
  status: z.number(),
  capturedAt: z.number(),
  headers: z.record(z.string(), z.string()),
});
const census = z
  .object({
    opening: z.array(z.unknown()),
    closing: z.array(z.unknown()),
    searches: z.array(ReceiptSchema.extend({ body: z.unknown() })),
    requests: z.array(ReceiptSchema),
    summary: z.object({
      unionUniqueStocks: z.number(),
      searchUniqueStocks: z.number(),
      searchOnlyCount: z.number(),
      liveRequests: z.number(),
      openingClosingStocksEqual: z.boolean(),
    }),
  })
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL("./byot-test-fixtures/waco-census.json.br", import.meta.url),
        ),
      ).toString(),
    ),
  );

const stock = z.object({ StockId: z.string(), images: z.array(z.string()) });
const queryUrls = new Map(
  BYOT_QUERIES.map((_, index) => [byotSearchUrl("1123", index), index]),
);
const buckets = census.searches.map((request) => {
  const index = queryUrls.get(request.url);
  if (index === undefined)
    throw new Error(
      "Saved Waco sweep left the qualified native controls: " + request.url,
    );
  return {
    query: byotQueryKey(index),
    checkedAt: request.capturedAt,
    records: byotValue(
      parseByotResponse(JSON.stringify(request.body), "search"),
    ),
  };
});

test("the paced Waco census visits every qualified native make/model control exactly once", () => {
  expect(census.searches).toHaveLength(BYOT_QUERIES.length);
  expect(new Set(census.searches.map((request) => request.url))).toEqual(
    new Set(queryUrls.keys()),
  );
  expect(census.requests).toHaveLength(census.summary.liveRequests);
  expect(census.requests.every((request) => request.status === 200)).toBe(true);
  for (const [index, request] of census.searches.entries()) {
    expect(request.headers["Content-Type"]).toStartWith("application/json");
    const previous = census.searches[index - 1];
    if (previous)
      expect(request.capturedAt - previous.capturedAt).toBeGreaterThanOrEqual(
        2000,
      );
  }
});
test("Waco's complete arrivals/search union recovers both F150 controls and all unphotographed search-only stock", () => {
  const opening = z.array(stock).parse(census.opening);
  const openingStocks = new Set(opening.map((row) => row.StockId));
  const searched = z
    .array(stock)
    .parse(buckets.flatMap((bucket) => bucket.records));
  const searchedStocks = new Set(searched.map((row) => row.StockId));
  const unionStocks = new Set([...openingStocks, ...searchedStocks]);
  const searchOnly = searched.filter((row) => !openingStocks.has(row.StockId));
  expect(unionStocks.size).toBe(census.summary.unionUniqueStocks);
  expect(searchedStocks.size).toBe(census.summary.searchUniqueStocks);
  expect(new Set(searchOnly.map((row) => row.StockId)).size).toBe(
    census.summary.searchOnlyCount,
  );
  expect(searchOnly.every((row) => row.images.length === 0)).toBe(true);
  const snapshot = byotSnapshot(
    [census.opening, ...byotFeeds.slice(1)],
    [buckets, [], [], [], []],
  );
  expect(snapshot.validation.ok).toBe(true);
  expect(snapshot.yardCounts).toEqual([1285, 967, 1073, 1036, 969]);
  expect(snapshot.vehicles).toHaveLength(5330);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 5347,
    recordsExcluded: 0,
    recordsRejected: 16,
    duplicateVehicles: 1,
  });
  for (const [stockNumber, vin] of [
    ["STK044158", "1FTRW07683KA65767"],
    ["STK044160", "1FTPX14584NC18315"],
  ] as const) {
    expect(openingStocks.has(stockNumber)).toBe(false);
    expect(
      snapshot.vehicles.find((row) => row.stockNumber === stockNumber),
    ).toMatchObject({
      vin,
      source: "byot",
      locationCode: "1123",
      imageUrl: null,
    });
  }
  expect(snapshot.accounting.recordsExcluded).toBe(0);
});
test("the Waco closing feed agrees with the opening controls and every listed donor remains union evidence", () => {
  const opening = z.array(stock).parse(census.opening),
    closing = z.array(stock).parse(census.closing);
  expect(census.summary.openingClosingStocksEqual).toBe(true);
  expect(new Set(closing.map((row) => row.StockId))).toEqual(
    new Set(opening.map((row) => row.StockId)),
  );
});

test("the full sweep reproduces all prior missing Waco controls and the Jeep search corrections", () => {
  const searched = z
    .array(stock)
    .parse(buckets.flatMap((bucket) => bucket.records));
  for (const code of [
    "STK044638",
    "STK044087",
    "STK044163",
    "STK043073",
    "STK043930",
    "STK043139",
    "STK044099",
    "STK044158",
    "STK044160",
    "STK043566",
    "STK044594",
    "STK044185",
    "STK043809",
    "STK043995",
    "STK044035",
    "STK043846",
    "STK043541",
  ]) {
    expect(searched.find((row) => row.StockId === code)).toMatchObject({
      images: [],
    });
  }
  for (const model of ["WRANGLER", "COMPASS", "RENEGADE", "JEEP TRUCK"]) {
    const index = BYOT_QUERIES.findIndex(
      (query) => query.make === "JEEP" && query.model === model,
    );
    const result = buckets.find(
      (bucket) => bucket.query === byotQueryKey(index),
    );
    expect(result?.records.length).toBeGreaterThan(0);
  }
});

test("a full cached sweep for all five yards stays below the cursor wire cap", () => {
  const previous = byotTerminal(0);
  if (previous.phase !== "complete") throw new Error("Missing terminal cursor");
  const cursor = byotValue(
    ByotCursor.checkpoint({
      ...previous,
      cache: Array.from({ length: 5 }, () =>
        buckets.map((bucket) => ({
          ...bucket,
          checkedAt: previous.completedAt,
        })),
      ),
    }),
  );
  if (cursor.phase !== "complete") throw new Error("Missing terminal cursor");
  const wire = byotValue(ByotCursor.serialize(cursor));
  expect(Buffer.byteLength(wire)).toBeLessThan(BYOT_MAX_CURSOR_BYTES);
  expect(ByotCursor.fromWire(wire).ok).toBe(true);
  expect(
    ByotCursor.checkpoint({
      ...cursor,
      cache: cursor.cache.map((yard, index) =>
        index === 0
          ? [
              ...yard,
              {
                query: "a".repeat(64),
                checkedAt: cursor.completedAt,
                records: ["x".repeat(BYOT_MAX_CURSOR_BYTES)],
              },
            ]
          : yard,
      ),
    }).ok,
  ).toBe(false);
});
