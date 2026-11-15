import type { ChasencarsStreamResult } from "../src/server/ingestion/chasencars-connector";
import {
  ChasencarsCursor,
  CHASENCARS_MAX_REQUESTS,
} from "../src/server/ingestion/chasencars-cursor";

/** Count-only traversal; a capped opening retains its incomplete checkpoint. */
export async function soakChasencarsInventory(
  runChunk: (
    cursor: ChasencarsCursor,
    maxPages: number,
  ) => Promise<ChasencarsStreamResult>,
  maxRequests = CHASENCARS_MAX_REQUESTS,
): Promise<ChasencarsStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Chase N Cars soak requires a positive integer GET budget");
  let cursor = ChasencarsCursor.initial(null);
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(6, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const resumed = ChasencarsCursor.parse(chunk.cursor, null);
    if (
      chunk.source !== "chasencars" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      resumed.requests !== cursor.requests + chunk.pagesProcessed ||
      (chunk.status === "complete") !== (resumed.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          chunk.accounting.recordsProcessed !== 0 ||
          chunk.observedVins.length !== 0))
    )
      throw new Error(
        "Chase N Cars soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    cursor = resumed;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error(
    "Chase N Cars soak exhausted its GET budget without a result",
  );
}
