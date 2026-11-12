import type { RustyhookStreamResult } from "../src/server/ingestion/rustyhook-connector";
import {
  RUSTYHOOK_MAX_RUN_REQUESTS,
  RustyhookCursor,
} from "../src/server/ingestion/rustyhook-cursor";

/** Count-only caller-supplied runner, with no database or publication writes. */
export async function soakRustyhookInventory(
  runChunk: (
    cursor: RustyhookCursor,
    maxPages: number,
  ) => Promise<RustyhookStreamResult>,
  maxRequests = RUSTYHOOK_MAX_RUN_REQUESTS,
): Promise<RustyhookStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error(
      "Rusty Hook soak requires a positive integer request budget",
    );
  let cursor = RustyhookCursor.initial;
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const chunk = await runChunk(
      cursor,
      Math.min(3, maxRequests - pagesProcessed),
    );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        RustyhookCursor.serialize(chunk.cursor) ===
          RustyhookCursor.serialize(cursor))
    )
      throw new Error(
        "Rusty Hook soak made no progress; retain the last validated checkpoint and inspect the source",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = RustyhookCursor.parse(RustyhookCursor.serialize(chunk.cursor));
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Rusty Hook soak exhausted its budget without a result");
}
