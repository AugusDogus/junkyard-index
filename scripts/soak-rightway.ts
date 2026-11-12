import { RightwayCursor } from "../src/server/ingestion/rightway-cursor";
import type { RightwayStreamResult } from "../src/server/ingestion/rightway-connector";

/** One unfiltered inline catalog is one checkpoint. Caller discards batches. */
export async function soakRightwayInventory(
  runChunk: (
    cursor: RightwayCursor,
    maxPages: number,
  ) => Promise<RightwayStreamResult>,
  maxPages = 1,
): Promise<RightwayStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new Error("Rightway soak requires a positive integer catalog budget");
  return runChunk(RightwayCursor.initial, Math.min(maxPages, 32));
}
