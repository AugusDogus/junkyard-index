import {
  DdautoCursor,
  DdautoCursorSchema,
} from "../src/server/ingestion/ddauto-cursor";
import type { DdautoStreamResult } from "../src/server/ingestion/ddauto-connector";

/** One complete, bounded native query. The caller counts/discards batches without writes. */
export async function soakDdautoInventory(
  runChunk: (
    cursor: DdautoCursor,
    maxPages: number,
  ) => Promise<DdautoStreamResult>,
  maxPages = 1,
): Promise<DdautoStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new Error("DD Auto soak requires a positive integer catalog budget");
  const result = await runChunk(DdautoCursor.initial, Math.min(maxPages, 32));
  const cursor = DdautoCursorSchema.parse(result.cursor);
  if (
    result.status !== "complete" ||
    cursor.phase !== "complete" ||
    result.pagesProcessed !== 1
  )
    throw new Error(
      "DD Auto soak did not finish one complete inventory read; retain prior inventory and inspect the native table",
    );
  return result;
}
