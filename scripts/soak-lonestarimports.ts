import type { LonestarimportsStreamResult } from "../src/server/ingestion/lonestarimports-connector";
import { LonestarimportsCursor } from "../src/server/ingestion/lonestarimports-cursor";

/** Count-only native traversal, preserving incomplete checkpoints at the GET cap. */
export async function soakLonestarimportsInventory(
  runChunk: (
    cursor: LonestarimportsCursor,
    maxPages: number,
  ) => Promise<LonestarimportsStreamResult>,
  maxRequests = 1008,
): Promise<LonestarimportsStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error(
      "Lonestar Imports soak requires a positive integer GET budget",
    );
  let cursor = LonestarimportsCursor.initial(null),
    pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const payload: unknown = JSON.parse(JSON.stringify(chunk.cursor));
    const resumed = LonestarimportsCursor.parse(payload);
    if (
      chunk.source !== "lonestarimports" ||
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
        "Lonestar Imports soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    cursor = resumed;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error(
    "Lonestar Imports soak exhausted its GET budget without a result",
  );
}
