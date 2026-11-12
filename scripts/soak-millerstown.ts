import {
  MillerstownCursor,
  MillerstownCursorSchema,
} from "../src/server/ingestion/millerstown-cursor";
import type { MillerstownStreamResult } from "../src/server/ingestion/millerstown-connector";

/** Read-only count/discard driver. Caller owns callbacks and the request gate. */
export async function soakMillerstownInventory(
  runChunk: (
    cursor: MillerstownCursor,
    maxPages: number,
  ) => Promise<MillerstownStreamResult>,
  maxPages = 1,
): Promise<MillerstownStreamResult> {
  if (maxPages !== 1)
    throw new Error(
      "Millerstown soak requires one atomic complete-catalog budget",
    );
  const result = await runChunk({ ...MillerstownCursor.initial }, 1);
  const cursor = MillerstownCursorSchema.parse(result.cursor);
  if (
    result.status !== "complete" ||
    cursor.phase !== "complete" ||
    result.pagesProcessed !== 1
  )
    throw new Error(
      "Millerstown soak did not prove one complete catalog; retain prior inventory and retry from start after inspecting the source",
    );
  return { ...result, cursor };
}
