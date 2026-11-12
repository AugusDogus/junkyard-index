import { PickersCursor } from "../src/server/ingestion/pickers-cursor";
import type { PickersStreamResult } from "../src/server/ingestion/pickers-connector";
import {
  PICKERS_MAX_MAKES,
  PICKERS_MAX_QUERIES,
} from "../src/server/ingestion/pickers-parser";

/** Read-only driver. The caller owns staging and the provider request gate. */
export async function soakPickersInventory(
  runChunk: (
    cursor: PickersCursor,
    maxPages: number,
  ) => Promise<PickersStreamResult>,
  maxPages = 2 * PICKERS_MAX_MAKES + PICKERS_MAX_QUERIES + 2,
): Promise<PickersStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 642)
    throw new Error(
      "Pickers soak requires a finite data-control budget from 1 to 642",
    );
  const summary: PickersStreamResult = {
    source: "pickers",
    status: "paused",
    cursor: PickersCursor.initial,
    count: 0,
    errors: [],
    warnings: [],
    observedVins: [],
    pagesProcessed: 0,
    accounting: {
      recordsProcessed: 0,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
  };
  while (summary.pagesProcessed < maxPages) {
    const chunk = await runChunk(
      summary.cursor,
      Math.min(16, maxPages - summary.pagesProcessed),
    );
    const cursor = PickersCursor.parse(PickersCursor.serialize(chunk.cursor));
    if (chunk.status === "failed") return chunk;
    if ((chunk.status === "complete") !== (cursor.phase === "complete"))
      throw new Error(
        "Pickers soak status disagrees with terminal proof; retain the last validated checkpoint",
      );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed <= 0 ||
        PickersCursor.serialize(cursor) ===
          PickersCursor.serialize(summary.cursor) ||
        chunk.count !== 0 ||
        (chunk.observedVins?.length ?? 0) !== 0 ||
        !chunk.accounting ||
        Object.values(chunk.accounting).some((value) => value !== 0))
    )
      throw new Error(
        "Pickers paused chunk made no validated progress or emitted premature donor accounting; retain the last checkpoint",
      );
    summary.pagesProcessed += chunk.pagesProcessed;
    summary.cursor = cursor;
    summary.status = chunk.status;
    summary.errors.push(...chunk.errors);
    summary.warnings = [
      ...new Set([...(summary.warnings ?? []), ...(chunk.warnings ?? [])]),
    ];
    if (chunk.status === "complete")
      return {
        ...chunk,
        pagesProcessed: summary.pagesProcessed,
        errors: summary.errors,
        warnings: summary.warnings,
      };
  }
  return summary;
}
