import { IdipullCursor } from "../src/server/ingestion/idipull-cursor";
import type { IdipullStreamResult } from "../src/server/ingestion/idipull-connector";

/** One complete inline catalog is one checkpoint. The caller discards batches. */
export async function soakIdipullInventory(
  runChunk: (
    cursor: IdipullCursor,
    maxPages: number,
  ) => Promise<IdipullStreamResult>,
  maxPages = 1,
): Promise<IdipullStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error(
      "Idaho Falls soak requires a positive integer catalog budget",
    );
  }
  return runChunk(IdipullCursor.initial, Math.min(maxPages, 32));
}
