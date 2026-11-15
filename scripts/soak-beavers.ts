import type { Effect } from "effect";
import type { streamBeaversInventory } from "../src/server/ingestion/beavers-connector";
import { BeaversCursor } from "../src/server/ingestion/beavers-cursor";

type BeaversResult = Effect.Effect.Success<
  ReturnType<typeof streamBeaversInventory>
>;

/** Read-only traversal. The source emits only after all closing controls pass. */
export async function soakBeaversInventory(
  runChunk: (cursor: BeaversCursor, maxPages: number) => Promise<BeaversResult>,
  maxRequests = 4200,
): Promise<BeaversResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Beaver's soak requires a positive integer GET budget");
  let cursor: BeaversCursor = BeaversCursor.initial;
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const before = BeaversCursor.serialize(cursor);
    const chunk = await runChunk(cursor, budget);
    const wire = BeaversCursor.serialize(chunk.cursor);
    const next = BeaversCursor.parse(wire);
    if (
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 0 ||
      chunk.pagesProcessed > budget ||
      (chunk.status === "complete") !== (next.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.pagesProcessed === 0 || wire === before || chunk.count !== 0))
    )
      throw new Error(
        "Beaver's soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = next;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, pagesProcessed };
  }
  throw new Error("Beaver's soak exhausted its GET budget without a result");
}
