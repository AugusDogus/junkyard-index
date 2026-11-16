import type { HarrysStreamResult } from "../src/server/ingestion/harrys-connector";
import { HarrysCursor } from "../src/server/ingestion/harrys-cursor";
import { HARRYS_MAX_PAGES } from "../src/server/ingestion/harrys-yard-metadata";

/** Opening/closing pages and two owner controls, without persistence. */
export async function soakHarrysInventory(
  runChunk: (
    cursor: HarrysCursor,
    maxPages: number,
  ) => Promise<HarrysStreamResult>,
  maxRequests = HARRYS_MAX_PAGES * 2 + 2,
): Promise<HarrysStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Harry's soak requires a positive integer GET budget");
  let cursor = HarrysCursor.initial();
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const before = JSON.stringify(cursor);
    const chunk = await runChunk(cursor, budget);
    const wire = JSON.stringify(chunk.cursor);
    if (Buffer.byteLength(wire) > 8 * 1024 * 1024)
      throw new Error("Harry's serialized checkpoint exceeds 8 MiB");
    const next = HarrysCursor.fromWire(wire);
    if (
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 0 ||
      chunk.pagesProcessed > budget ||
      (chunk.status === "complete") !== (next.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.pagesProcessed === 0 || wire === before || chunk.count !== 0))
    )
      throw new Error(
        "Harry's soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = next;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Harry's soak exhausted its GET budget without a result");
}
