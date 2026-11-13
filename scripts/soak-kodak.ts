import type { KodakStreamResult } from "../src/server/ingestion/kodak-connector";
import { KodakCursor } from "../src/server/ingestion/kodak-cursor";

/** Serialized, count-only caller-supplied runner. No implicit HTTP or writes. */
export async function soakKodakInventory(
  runChunk: (
    cursor: KodakCursor,
    maxPages: number,
  ) => Promise<KodakStreamResult>,
  maxRequests = 2,
): Promise<KodakStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > 2)
    throw new Error("Kodak soak requires 1-2 serial request units");
  let cursor: KodakCursor = KodakCursor.initial;
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const result = await runChunk(cursor, 1);
    if (
      result.pagesProcessed < 0 ||
      result.pagesProcessed > 1 ||
      (result.status === "paused" &&
        (result.pagesProcessed === 0 ||
          KodakCursor.serialize(result.cursor) ===
            KodakCursor.serialize(cursor)))
    )
      throw new Error(
        "Kodak soak made no bounded progress; retain the last validated checkpoint",
      );
    pagesProcessed += result.pagesProcessed;
    cursor = KodakCursor.parse(KodakCursor.serialize(result.cursor));
    if (result.status === "complete" || pagesProcessed === maxRequests)
      return { ...result, cursor, pagesProcessed };
  }
  throw new Error("Kodak soak exhausted its bounded request budget");
}
