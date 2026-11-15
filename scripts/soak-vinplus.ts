import {
  VinplusCursor,
  VINPLUS_MAX_REQUESTS,
} from "../src/server/ingestion/vinplus-cursor";
import type { VinplusStreamResult } from "../src/server/ingestion/vinplus-connector";
/** Read-only driver. Caller owns staging; no flags, database or index writes. */
export async function soakVinplusInventory(
  runChunk: (
    cursor: VinplusCursor,
    maxPages: number,
  ) => Promise<VinplusStreamResult>,
  maxRequests = VINPLUS_MAX_REQUESTS,
): Promise<VinplusStreamResult> {
  if (
    !Number.isInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > VINPLUS_MAX_REQUESTS
  )
    throw new Error("VinPlus soak requires a request budget from 1 to 2048");
  let cursor = VinplusCursor.initial(),
    pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const before = VinplusCursor.serialize(cursor);
    const chunk = await runChunk(
      cursor,
      Math.min(8, maxRequests - pagesProcessed),
    );
    const wire = VinplusCursor.serialize(chunk.cursor);
    cursor = VinplusCursor.fromWire(wire);
    pagesProcessed += chunk.pagesProcessed;
    if (
      chunk.status === "paused" &&
      (chunk.count !== 0 ||
        chunk.observedVins?.length ||
        Object.values(chunk.accounting ?? {}).some((value) => value !== 0) ||
        before === wire ||
        chunk.pagesProcessed === 0)
    )
      throw new Error(
        "VinPlus soak emitted premature donor accounting or stalled before terminal controls",
      );
    if (chunk.status === "complete" || pagesProcessed >= maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("VinPlus soak exhausted its request budget");
}
