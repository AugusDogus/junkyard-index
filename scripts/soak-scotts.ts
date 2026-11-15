import type { ScottsStreamResult } from "../src/server/ingestion/scotts-connector";
import {
  ScottsCursor,
  SCOTTS_MAX_REQUESTS,
} from "../src/server/ingestion/scotts-cursor";

/** Count-only public traversal. Partial chunks emit no inventory. */
export async function soakScottsInventory(
  runChunk: (
    cursor: ScottsCursor,
    maxPages: number,
  ) => Promise<ScottsStreamResult>,
  maxRequests = SCOTTS_MAX_REQUESTS,
): Promise<ScottsStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Scott's soak requires a positive integer GET budget");
  let cursor = ScottsCursor.initial;
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(6, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const resumed = ScottsCursor.parse(ScottsCursor.serialize(chunk.cursor));
    if (
      chunk.source !== "scotts" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      (chunk.status === "complete") !== (resumed.phase === "complete") ||
      (resumed.phase !== "complete" &&
        (resumed.requests !== cursor.requests + chunk.pagesProcessed ||
          chunk.count !== 0 ||
          chunk.accounting.recordsProcessed !== 0))
    )
      throw new Error(
        "Scott's soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    pagesProcessed += chunk.pagesProcessed;
    if (resumed.phase === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor: resumed, pagesProcessed };
    cursor = resumed;
  }
  throw new Error("Scott's soak exhausted its GET budget without a result");
}
