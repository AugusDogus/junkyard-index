import type { KandrStreamResult } from "../src/server/ingestion/kandr-connector";
import { KANDR_CONTRACT } from "../src/server/ingestion/kandr-configuration";
import {
  KANDR_MAX_REQUESTS,
  KandrCursor,
} from "../src/server/ingestion/kandr-cursor";

/** Count-only native graph traversal with serialized checkpoints and no writes. */
export async function soakKandrInventory(
  runChunk: (
    cursor: KandrCursor,
    maxPages: number,
  ) => Promise<KandrStreamResult>,
  maxRequests = KANDR_MAX_REQUESTS,
): Promise<KandrStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("Kandr soak requires a positive integer request budget");
  const initial = KandrCursor.initial(KANDR_CONTRACT);
  if (!initial.ok) throw new Error(initial.error.message);
  let cursor = initial.value,
    pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const wire = KandrCursor.serialize(chunk.cursor, KANDR_CONTRACT);
    if (!wire.ok) throw new Error(wire.error.message);
    const parsed = KandrCursor.fromWire(wire.value, KANDR_CONTRACT);
    if (!parsed.ok) throw new Error(parsed.error.message);
    if (
      chunk.source !== "kandr" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      parsed.value.requests !== cursor.requests + chunk.pagesProcessed ||
      (chunk.status === "complete") !== (parsed.value.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          Object.values(chunk.accounting).some((n) => n !== 0) ||
          chunk.observedVins.length !== 0))
    )
      throw new Error(
        "Kandr soak made no progress; retain the last validated checkpoint and inspect the source",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = parsed.value;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Kandr soak exhausted its budget without a result");
}
