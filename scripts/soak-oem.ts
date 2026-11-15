import type { Effect } from "effect";
import type { streamOemInventory } from "../src/server/ingestion/oem-connector";
import {
  OemCursor,
  OemCursorSchema,
  OEM_MAX_REQUESTS,
} from "../src/server/ingestion/oem-cursor";

type OemResult = Effect.Effect.Success<ReturnType<typeof streamOemInventory>>;

/** Count-only traversal. Inventory stays staged until closing and quality pass. */
export async function soakOemInventory(
  runChunk: (cursor: OemCursor, maxPages: number) => Promise<OemResult>,
  maxRequests = OEM_MAX_REQUESTS,
): Promise<OemResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("OEM soak requires a positive integer GET budget");
  let cursor = OemCursor.initial();
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const next = OemCursorSchema.parse(chunk.cursor);
    if (
      chunk.source !== "oem" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 0 ||
      chunk.pagesProcessed > budget ||
      next.requests !== cursor.requests + chunk.pagesProcessed ||
      (chunk.status === "complete") !== (next.state.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.pagesProcessed === 0 ||
          chunk.count !== 0 ||
          chunk.accounting.recordsProcessed !== 0))
    )
      throw new Error(
        "OEM soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = next;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("OEM soak exhausted its GET budget without a result");
}
