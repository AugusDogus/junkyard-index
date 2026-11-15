import type { AlliedStreamResult } from "../src/server/ingestion/allied-connector";
import { ALLIED_CONTRACT } from "../src/server/ingestion/allied-configuration";
import {
  ALLIED_MAX_REQUESTS,
  AlliedCursor,
} from "../src/server/ingestion/allied-cursor";

/** Count-only runner with serialized checkpoints and no database writes. */
export async function soakAlliedInventory(
  runChunk: (
    cursor: AlliedCursor,
    maxPages: number,
  ) => Promise<AlliedStreamResult>,
  maxRequests = ALLIED_MAX_REQUESTS,
): Promise<AlliedStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Allied soak requires a positive integer request budget");
  let cursor = AlliedCursor.initial(ALLIED_CONTRACT);
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const chunk = await runChunk(
      cursor,
      Math.min(4, maxRequests - pagesProcessed),
    );
    const wire = AlliedCursor.serialize(chunk.cursor, ALLIED_CONTRACT);
    if (!wire.ok) throw new Error(wire.error.message);
    const parsed = AlliedCursor.fromWire(wire.value, ALLIED_CONTRACT);
    if (!parsed.ok) throw new Error(parsed.error.message);
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 || parsed.value.requests <= cursor.requests)
    )
      throw new Error(
        "Allied soak made no progress; retain the last validated checkpoint and inspect the source",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = parsed.value;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Allied soak exhausted its budget without a result");
}
