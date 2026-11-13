import type { PrattStreamResult } from "../src/server/ingestion/pratt-connector";
import { PRATT_CONTRACT } from "../src/server/ingestion/pratt-configuration";
import {
  PRATT_MAX_REQUESTS,
  PrattCursor,
} from "../src/server/ingestion/pratt-cursor";

/** Count-only runner with serialized checkpoints and no database writes. */
export async function soakPrattInventory(
  runChunk: (
    cursor: PrattCursor,
    maxPages: number,
  ) => Promise<PrattStreamResult>,
  maxRequests = PRATT_MAX_REQUESTS,
): Promise<PrattStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Pratt soak requires a positive integer request budget");
  let cursor = PrattCursor.initial(PRATT_CONTRACT);
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const chunk = await runChunk(
      cursor,
      Math.min(8, maxRequests - pagesProcessed),
    );
    const wire = PrattCursor.serialize(chunk.cursor, PRATT_CONTRACT);
    if (!wire.ok) throw new Error(wire.error.message);
    const parsed = PrattCursor.fromWire(wire.value, PRATT_CONTRACT);
    if (!parsed.ok) throw new Error(parsed.error.message);
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 || parsed.value.requests <= cursor.requests)
    )
      throw new Error(
        "Pratt soak made no progress; retain the last validated checkpoint and inspect the source",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = parsed.value;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Pratt soak exhausted its budget without a result");
}
