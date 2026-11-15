import type { AlshnedStreamResult } from "../src/server/ingestion/alshned-connector";
import { AlshnedCursor } from "../src/server/ingestion/alshned-cursor";

/** Count-only native traversal, preserving incomplete checkpoints at the GET cap. */
export async function soakAlshnedInventory(
  runChunk: (
    cursor: AlshnedCursor,
    maxPages: number,
  ) => Promise<AlshnedStreamResult>,
  maxRequests = 1000,
): Promise<AlshnedStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Alshned soak requires a positive integer GET budget");
  let cursor = AlshnedCursor.initial,
    pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(12, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const payload: unknown = JSON.parse(JSON.stringify(chunk.cursor));
    const resumed = AlshnedCursor.parse(payload);
    if (
      chunk.source !== "alshned" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      JSON.stringify(cursor) === JSON.stringify(resumed) ||
      (chunk.status === "complete") !== (resumed.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          Object.values(chunk.accounting).some((n) => n !== 0) ||
          chunk.observedVins.length !== 0))
    )
      throw new Error(
        "Alshned soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    cursor = resumed;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Alshned soak exhausted its GET budget without a result");
}
