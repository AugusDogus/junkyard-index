import type { RohnerStreamResult } from "../src/server/ingestion/rohner-connector";
import {
  ROHNER_MAX_RUN_REQUESTS,
  RohnerCursor,
} from "../src/server/ingestion/rohner-cursor";

/** Count-only runner with serialized checkpoints and no database writes. */
export async function soakRohnerInventory(
  runChunk: (
    cursor: RohnerCursor,
    maxPages: number,
  ) => Promise<RohnerStreamResult>,
  maxRequests = ROHNER_MAX_RUN_REQUESTS,
): Promise<RohnerStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Rohner soak requires a positive integer request budget");
  let cursor = RohnerCursor.initial;
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const chunk = await runChunk(
      cursor,
      Math.min(3, maxRequests - pagesProcessed),
    );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        RohnerCursor.serialize(chunk.cursor) === RohnerCursor.serialize(cursor))
    )
      throw new Error(
        "Rohner soak made no progress; retain the last validated checkpoint and inspect the source",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = RohnerCursor.parse(RohnerCursor.serialize(chunk.cursor));
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Rohner soak exhausted its budget without a result");
}
