import type { WeberbrothersStreamResult } from "../src/server/ingestion/weberbrothers-connector";
import {
  WeberbrothersCursor,
  inspectWeberbrothersCursor,
  WEBERBROTHERS_MAX_RUN_REQUESTS,
} from "../src/server/ingestion/weberbrothers-cursor";

/** Count-only complete traversal, retaining a resumable frontier when capped. */
export async function soakWeberbrothersInventory(
  runChunk: (
    cursor: WeberbrothersCursor,
    maxPages: number,
  ) => Promise<WeberbrothersStreamResult>,
  maxRequests = WEBERBROTHERS_MAX_RUN_REQUESTS,
): Promise<WeberbrothersStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error(
      "Weber Brothers soak requires a positive integer GET budget",
    );
  let cursor = WeberbrothersCursor.initial;
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(10, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const resumed = WeberbrothersCursor.parse(
      WeberbrothersCursor.serialize(chunk.cursor),
    );
    if (
      chunk.source !== "weberbrothers" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      inspectWeberbrothersCursor(resumed).requests !==
        pagesProcessed + chunk.pagesProcessed ||
      (chunk.status === "complete") !== (resumed.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          chunk.observedVins.length !== 0 ||
          Object.values(chunk.accounting).some((count) => count !== 0)))
    )
      throw new Error(
        "Weber Brothers soak made no valid progress; retain the checkpoint and inspect the native response",
      );
    cursor = resumed;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error(
    "Weber Brothers soak exhausted its GET budget without a result",
  );
}
