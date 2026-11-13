import type { Cars4PartsStreamResult } from "../src/server/ingestion/cars4parts-connector";
import { CARS4PARTS_CONTRACT } from "../src/server/ingestion/cars4parts-configuration";
import {
  CARS4PARTS_MAX_REQUESTS,
  Cars4PartsCursor,
} from "../src/server/ingestion/cars4parts-cursor";

/** Count-only runner with validated serialized checkpoints and no DB writes. */
export async function soakCars4PartsInventory(
  runChunk: (
    cursor: Cars4PartsCursor,
    maxPages: number,
  ) => Promise<Cars4PartsStreamResult>,
  maxRequests = CARS4PARTS_MAX_REQUESTS,
): Promise<Cars4PartsStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error(
      "Cars4Parts soak requires a positive integer request budget",
    );
  let cursor = Cars4PartsCursor.initial(CARS4PARTS_CONTRACT);
  let pagesProcessed = 0;
  while (pagesProcessed < maxRequests) {
    const chunk = await runChunk(
      cursor,
      Math.min(8, maxRequests - pagesProcessed),
    );
    const payload: unknown = JSON.parse(JSON.stringify(chunk.cursor));
    const parsed = Cars4PartsCursor.parse(payload, CARS4PARTS_CONTRACT);
    if (!parsed.ok) throw new Error(parsed.error.message);
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 || parsed.value.requests <= cursor.requests)
    )
      throw new Error(
        "Cars4Parts soak made no progress; retain the validated checkpoint and inspect the source",
      );
    pagesProcessed += chunk.pagesProcessed;
    cursor = parsed.value;
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed };
  }
  throw new Error("Cars4Parts soak exhausted its budget without a result");
}
