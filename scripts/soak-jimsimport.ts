import type { JimsimportStreamResult } from "../src/server/ingestion/jimsimport-connector";
import { JimsimportCursor } from "../src/server/ingestion/jimsimport-cursor";

/** Count-only native traversal, preserving incomplete checkpoints at the GET cap. */
export async function soakJimsimportInventory(
  runChunk: (
    cursor: JimsimportCursor,
    maxPages: number,
  ) => Promise<JimsimportStreamResult>,
  maxRequests = 1_024,
): Promise<JimsimportStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Jim's Import soak requires a positive integer GET budget");
  let cursor = JimsimportCursor.initial(),
    pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const payload: unknown = JSON.parse(JSON.stringify(chunk.cursor));
    const resumed = JimsimportCursor.parse(payload);
    if (
      chunk.source !== "jimsimport" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      resumed.requests !== cursor.requests + chunk.pagesProcessed ||
      (chunk.status === "complete") !== (resumed.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          Object.values(chunk.accounting).some((n) => n !== 0) ||
          chunk.observedVins.length !== 0))
    )
      throw new Error(
        "Jim's Import soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    cursor = resumed;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error(
    "Jim's Import soak exhausted its GET budget without a result",
  );
}
