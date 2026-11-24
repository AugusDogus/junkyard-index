import {
  BYOT_CHUNK_REQUESTS,
  ByotCursor,
  BYOT_RUN_REQUESTS,
} from "../src/server/ingestion/byot-cursor";
import type { ByotStreamResult } from "../src/server/ingestion/byot-connector";

/** Count-only daily sweep. No database, Blob, Algolia or feature-flag writes. */
export async function soakByotInventory(
  runChunk: (cursor: ByotCursor, maxPages: number) => Promise<ByotStreamResult>,
  maxRequests = BYOT_RUN_REQUESTS,
): Promise<ByotStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("BYOT soak requires a positive integer request budget");
  let cursor = ByotCursor.initial(),
    pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const chunk = await runChunk(
      cursor,
      Math.min(BYOT_CHUNK_REQUESTS, maxRequests - pagesProcessed),
    );
    const wire = ByotCursor.serialize(chunk.cursor);
    if (!wire.ok) throw new Error(wire.error.message);
    const parsed = ByotCursor.fromWire(wire.value);
    if (!parsed.ok) throw new Error(parsed.error.message);
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 || JSON.stringify(cursor) === wire.value)
    )
      throw new Error(
        "BYOT soak made no progress; retain the last validated checkpoint and inspect the response",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = parsed.value;
    if (chunk.status === "complete" || pagesProcessed >= maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("BYOT soak exhausted its budget without a result");
}
