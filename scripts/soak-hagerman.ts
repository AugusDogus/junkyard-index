import type { HagermanStreamResult } from "../src/server/ingestion/hagerman-connector";
import {
  HagermanCursor,
  HagermanCursorSchema,
} from "../src/server/ingestion/hagerman-cursor";

/** Count-only native traversal. A request cap preserves the incomplete checkpoint. */
export async function soakHagermanInventory(
  runChunk: (
    cursor: HagermanCursor,
    maxPages: number,
  ) => Promise<HagermanStreamResult>,
  maxRequests = 29,
): Promise<HagermanStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Hagerman soak requires a positive integer GET budget");
  let cursor: HagermanCursor = HagermanCursor.initial;
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(12, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const resumed = HagermanCursorSchema.parse(chunk.cursor);
    if (
      chunk.source !== "hagerman" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      JSON.stringify(cursor) === JSON.stringify(resumed) ||
      (chunk.status === "complete") !== (resumed.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          chunk.accounting.recordsProcessed !== 0 ||
          chunk.observedVins.length !== 0))
    )
      throw new Error(
        "Hagerman soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    cursor = resumed;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Hagerman soak exhausted its GET budget without a result");
}
