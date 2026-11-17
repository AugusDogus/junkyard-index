import type { AlsautoStreamResult } from "../src/server/ingestion/alsauto-connector";
import { AlsautoCursor } from "../src/server/ingestion/alsauto-cursor";
import { ALSAUTO_MAX_REQUESTS } from "../src/server/ingestion/alsauto-configuration";

/** Count-only traversal; a capped opening retains its incomplete checkpoint. */
export async function soakAlsautoInventory(
  runChunk: (
    cursor: AlsautoCursor,
    maxPages: number,
  ) => Promise<AlsautoStreamResult>,
  maxRequests = ALSAUTO_MAX_REQUESTS,
): Promise<AlsautoStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error(
      "Al's Auto Salvage soak requires a positive integer GET budget",
    );
  let cursor = AlsautoCursor.initial(null);
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const resumed = AlsautoCursor.parse(chunk.cursor, null);
    if (
      chunk.source !== "alsauto" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      resumed.evidence.length !==
        cursor.evidence.length + chunk.pagesProcessed ||
      (chunk.status === "complete") !== (resumed.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          chunk.accounting.recordsProcessed !== 0 ||
          chunk.observedVins.length !== 0))
    )
      throw new Error(
        "Al's Auto Salvage soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    cursor = resumed;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error(
    "Al's Auto Salvage soak exhausted its GET budget without a result",
  );
}
