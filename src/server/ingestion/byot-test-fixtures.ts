import { ByotCursor, byotQueryKey, type ByotCache } from "./byot-cursor";
import { BYOT_DAILY_QUERIES, BYOT_QUERIES } from "./byot-directory";
import { ByotRecordSchema } from "./byot-record";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import type { ByotResult } from "./byot-result";
import { BYOT_YARDS } from "./byot-configuration";

export const byotFixtureFeeds = z
  .record(z.string(), z.array(z.unknown()))
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL("./byot-test-fixtures/arrivals.json.br", import.meta.url),
        ),
      ).toString(),
    ),
  );
export const byotFeeds = BYOT_YARDS.map(
  (yard) => byotFixtureFeeds[yard.code] ?? [],
);
export function byotValue<T>(result: ByotResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
/** Actual unphotographed positive control from Waco's native F150 response. */
const f150 = z
  .object({
    body: z.object({
      data: z.object({ availableVehicles: z.array(ByotRecordSchema) }),
    }),
  })
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL("./byot-test-fixtures/waco-f150.json.br", import.meta.url),
        ),
      ).toString(),
    ),
  );
const missingF150 = f150.body.data.availableVehicles.find(
  (row) => row.StockId === "STK044158",
);
if (!missingF150)
  throw new Error("Saved BYOT Waco F150 response lost STK044158");
export const byotMissingF150 = missingF150;

export function byotTerminal(
  offset: number,
  at = Date.UTC(2026, 10, 15),
  oldCache: ByotCache = BYOT_YARDS.map(() => []),
) {
  const initial = ByotCursor.initial();
  const cache = oldCache.map((yard) => [...yard]);
  for (const [yardIndex] of BYOT_YARDS.entries()) {
    const yard = cache[yardIndex];
    if (!yard) throw new Error("Missing fixture yard");
    for (let i = 0; i < BYOT_DAILY_QUERIES; i++) {
      const index = (offset + i) % BYOT_QUERIES.length;
      const query = byotQueryKey(index);
      const existing = yard.findIndex((bucket) => bucket.query === query);
      if (existing >= 0) yard.splice(existing, 1);
      yard.push({ query, checkedAt: at, records: [] });
    }
  }
  return byotValue(
    ByotCursor.checkpoint({
      source: "byot",
      version: 1,
      scope: initial.scope,
      directory: initial.directory,
      phase: "complete",
      completedAt: at,
      nextOffset: (offset + BYOT_DAILY_QUERIES) % BYOT_QUERIES.length,
      cache,
      yardCounts: [1200, 960, 1080, 1030, 970],
    }),
  );
}
