import type { Effect } from "effect";
import type { streamDutchersInventory } from "../src/server/ingestion/dutchers-connector";
import { DutchersCursor } from "../src/server/ingestion/dutchers-cursor";
import { DUTCHERS_MAX_PAGES } from "../src/server/ingestion/dutchers-yard-metadata";

type DutchersResult = Effect.Effect.Success<
  ReturnType<typeof streamDutchersInventory>
>;

/** Count-only traversal, with no inventory emitted before complete closure. */
export async function soakDutchersInventory(
  runChunk: (
    cursor: DutchersCursor,
    maxPages: number,
  ) => Promise<DutchersResult>,
  maxRequests = DUTCHERS_MAX_PAGES * 4 + 4,
): Promise<DutchersResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Dutcher soak requires a positive integer GET budget");
  let cursor = DutchersCursor.initial();
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const resumed = DutchersCursor.parse(chunk.cursor);
    if (
      chunk.source !== "dutchers" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      resumed.checksum === cursor.checksum ||
      (chunk.status === "complete") !== (resumed.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          chunk.accounting.recordsProcessed !== 0 ||
          chunk.accounting.recordsRejected !== 0 ||
          chunk.accounting.recordsExcluded !== 0 ||
          chunk.accounting.duplicateVehicles !== 0))
    )
      throw new Error(
        "Dutcher soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = resumed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Dutcher soak exhausted its GET budget without a result");
}
