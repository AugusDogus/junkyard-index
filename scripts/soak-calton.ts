import type { CaltonStreamResult } from "../src/server/ingestion/calton-connector";
import { CALTON_CONTRACT } from "../src/server/ingestion/calton-configuration";
import {
  CALTON_MAX_REQUESTS,
  CaltonCursor,
} from "../src/server/ingestion/calton-cursor";

/** Count-only native graph traversal with serialized checkpoints and no writes. */
export async function soakCaltonInventory(
  runChunk: (
    cursor: CaltonCursor,
    maxPages: number,
  ) => Promise<CaltonStreamResult>,
  maxRequests = CALTON_MAX_REQUESTS,
): Promise<CaltonStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Calton soak requires a positive integer request budget");
  const initial = CaltonCursor.initial(CALTON_CONTRACT);
  if (!initial.ok) throw new Error(initial.error.message);
  let cursor = initial.value,
    pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const chunk = await runChunk(
      cursor,
      Math.min(8, maxRequests - pagesProcessed),
    );
    const wire = CaltonCursor.serialize(chunk.cursor, CALTON_CONTRACT);
    if (!wire.ok) throw new Error(wire.error.message);
    const parsed = CaltonCursor.fromWire(wire.value, CALTON_CONTRACT);
    if (!parsed.ok) throw new Error(parsed.error.message);
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 || parsed.value.requests <= cursor.requests)
    )
      throw new Error(
        "Calton soak made no progress; retain the last validated checkpoint and inspect the source",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = parsed.value;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Calton soak exhausted its budget without a result");
}
