import type { streamHeavytruckpartsInventory } from "../src/server/ingestion/heavytruckparts-connector";
import type { Effect } from "effect";
import {
  HeavytruckpartsCursor,
  type HtpCursor,
} from "../src/server/ingestion/heavytruckparts-cursor";

type HtpStreamResult = Effect.Effect.Success<
  ReturnType<typeof streamHeavytruckpartsInventory>
>;

const HTP_MAX_REQUESTS = 512;

/** Count-only native traversal, preserving incomplete checkpoints at the GET cap. */
export async function soakHeavytruckpartsInventory(
  runChunk: (cursor: HtpCursor, maxPages: number) => Promise<HtpStreamResult>,
  maxRequests = HTP_MAX_REQUESTS,
): Promise<HtpStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("HTP soak requires a positive integer GET budget");
  let cursor = HeavytruckpartsCursor.initial(null),
    pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const budget = Math.min(8, maxRequests - pagesProcessed);
    const chunk = await runChunk(cursor, budget);
    const payload: unknown = JSON.parse(JSON.stringify(chunk.cursor));
    const resumed = HeavytruckpartsCursor.parse(payload);
    if (
      chunk.source !== "heavytruckparts" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget ||
      resumed.requests !== cursor.requests + chunk.pagesProcessed ||
      (chunk.status === "complete") !== (resumed.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.count !== 0 ||
          Object.values(chunk.accounting).some((n) => n !== 0) ||
          chunk.observedVins.length !== 0))
    )
      throw new Error(
        "HTP soak made no valid progress; retain the last checkpoint and inspect the native response",
      );
    cursor = resumed;
    pagesProcessed += chunk.pagesProcessed;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("HTP soak exhausted its GET budget without a result");
}
