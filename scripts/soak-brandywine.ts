import type { BrandywineStreamResult } from "../src/server/ingestion/brandywine-connector";
import {
  BrandywineCursor,
  BRANDYWINE_MAX_RUN_REQUESTS,
} from "../src/server/ingestion/brandywine-cursor";

/** Count-only native traversal. Serialized checkpoints never publish inventory. */
export async function soakBrandywineInventory(
  runChunk: (
    cursor: BrandywineCursor,
    maxPages: number,
  ) => Promise<BrandywineStreamResult>,
  maxPages = BRANDYWINE_MAX_RUN_REQUESTS / 2,
): Promise<BrandywineStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new Error(
      "Brandywine soak requires a positive logical-control budget",
    );
  let cursor = BrandywineCursor.initial(null);
  let pagesProcessed = 0;
  while (pagesProcessed < maxPages) {
    const chunk = await runChunk(
      cursor,
      Math.min(3, maxPages - pagesProcessed),
    );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        BrandywineCursor.serialize(chunk.cursor) ===
          BrandywineCursor.serialize(cursor))
    )
      throw new Error(
        "Brandywine soak made no progress; retain the last validated checkpoint and inspect the source",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = BrandywineCursor.parse(BrandywineCursor.serialize(chunk.cursor));
    if (chunk.status === "complete" || pagesProcessed === maxPages)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Brandywine soak exhausted its budget without a result");
}
