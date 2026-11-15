import type { DentonStreamResult } from "../src/server/ingestion/denton-connector";
import {
  DentonCursor,
  DENTON_MAX_REQUESTS,
} from "../src/server/ingestion/denton-cursor";

/** Count-only public traversal with validated checkpoints and no writes. */
export async function soakDentonInventory(
  runChunk: (
    cursor: DentonCursor,
    maxPages: number,
  ) => Promise<DentonStreamResult>,
  maxRequests = DENTON_MAX_REQUESTS,
): Promise<DentonStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Denton soak requires a positive integer GET budget");
  const initial = DentonCursor.initial(null);
  if (!initial.ok) throw new Error(initial.error.message);
  let cursor = initial.value;
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const wire = DentonCursor.serialize(chunk.cursor, null);
    if (!wire.ok) throw new Error(wire.error.message);
    const parsed = DentonCursor.fromWire(wire.value, null);
    if (!parsed.ok) throw new Error(parsed.error.message);
    if (
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 0 ||
      chunk.pagesProcessed > budget ||
      (chunk.status === "complete") !== (parsed.value.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.pagesProcessed === 0 ||
          parsed.value.requests <= cursor.requests ||
          chunk.count !== 0))
    )
      throw new Error(
        "Denton soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = parsed.value;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Denton soak exhausted its GET budget without a result");
}
