import { ArmyCursor } from "../src/server/ingestion/army-cursor";
import type { ArmyStreamResult } from "../src/server/ingestion/army-connector";

/** One unfiltered inline catalog is one checkpoint. Caller discards batches. */
export async function soakArmyInventory(
  runChunk: (cursor: ArmyCursor, maxPages: number) => Promise<ArmyStreamResult>,
  maxPages = 1,
): Promise<ArmyStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new Error("Army soak requires a positive integer catalog budget");
  return runChunk(ArmyCursor.initial, Math.min(maxPages, 32));
}
