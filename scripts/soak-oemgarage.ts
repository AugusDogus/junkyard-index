import type { OemgarageStreamResult } from "../src/server/ingestion/oemgarage-connector";
import { OemgarageCursor } from "../src/server/ingestion/oemgarage-cursor";

/** Count-only native traversal. A request cap preserves the incomplete checkpoint. */
export async function soakOemgarageInventory(
  runChunk: (
    cursor: OemgarageCursor,
    maxPages: number,
  ) => Promise<OemgarageStreamResult>,
  maxRequests = 2_004,
): Promise<OemgarageStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("oeM Garage soak requires a positive integer GET budget");
  let cursor = OemgarageCursor.initial();
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const resumed = OemgarageCursor.parse(chunk.cursor);
    if (
      chunk.source !== "oemgarage" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      cursor.checksum === resumed.checksum ||
      (chunk.status === "complete") !== (resumed.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          chunk.accounting.recordsProcessed !== 0 ||
          chunk.observedVins.length !== 0))
    )
      throw new Error(
        "oeM Garage soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    cursor = resumed;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("oeM Garage soak exhausted its GET budget without a result");
}
