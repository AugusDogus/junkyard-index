import type { HollanderstoresStreamResult } from "../src/server/ingestion/hollanderstores-connector";
import { HollanderstoresCursor } from "../src/server/ingestion/hollanderstores-cursor";

/** Count-only native traversal, preserving incomplete checkpoints at the logical request cap. */
export async function soakHollanderstoresInventory(
  runChunk: (
    cursor: HollanderstoresCursor,
    maxPages: number,
  ) => Promise<HollanderstoresStreamResult>,
  maxRequests = 210,
): Promise<HollanderstoresStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error(
      "Hollander Stores soak requires a positive integer logical request budget",
    );
  let cursor = HollanderstoresCursor.initial(null),
    pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(1, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const payload: unknown = JSON.parse(JSON.stringify(chunk.cursor));
    const resumed = HollanderstoresCursor.parse(payload);
    if (
      chunk.source !== "hollanderstores" ||
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
        "Hollander Stores soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    cursor = resumed;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error(
    "Hollander Stores soak exhausted its logical request budget without a result",
  );
}
