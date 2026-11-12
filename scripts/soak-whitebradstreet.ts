import { WhitebradstreetCursor } from "../src/server/ingestion/whitebradstreet-cursor";
import type { WhitebradstreetStreamResult } from "../src/server/ingestion/whitebradstreet-connector";

/** A read-only driver. The supplied connector callback counts/discards batches. */
export async function soakWhitebradstreetInventory(
  runChunk: (
    cursor: WhitebradstreetCursor,
    maxPages: number,
  ) => Promise<WhitebradstreetStreamResult>,
  maxPages = 400,
): Promise<WhitebradstreetStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 400)
    throw new Error(
      "White & Bradstreet soak requires a page budget from 1 to 400",
    );
  const summary: WhitebradstreetStreamResult = {
    source: "whitebradstreet",
    status: "paused",
    cursor: WhitebradstreetCursor.initial,
    count: 0,
    pagesProcessed: 0,
    errors: [],
    warnings: [],
    observedVins: [],
    accounting: {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  };
  const observed = new Set<string>();
  while (summary.pagesProcessed < maxPages) {
    const chunk = await runChunk(
      summary.cursor,
      Math.min(8, maxPages - summary.pagesProcessed),
    );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(chunk.cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "White & Bradstreet soak made no progress; retain the last validated checkpoint and inspect the native source",
      );
    summary.count += chunk.count;
    summary.pagesProcessed += chunk.pagesProcessed;
    summary.errors.push(...chunk.errors);
    summary.warnings = [
      ...new Set([...(summary.warnings ?? []), ...(chunk.warnings ?? [])]),
    ];
    for (const vin of chunk.observedVins ?? []) observed.add(vin);
    if (summary.accounting && chunk.accounting) {
      summary.accounting.recordsProcessed += chunk.accounting.recordsProcessed;
      summary.accounting.recordsExcluded += chunk.accounting.recordsExcluded;
      summary.accounting.recordsRejected += chunk.accounting.recordsRejected;
      summary.accounting.duplicateVehicles +=
        chunk.accounting.duplicateVehicles;
    }
    summary.cursor = chunk.cursor;
    summary.status = chunk.status;
    summary.observedVins = [...observed];
    if (chunk.status !== "paused") break;
  }
  return summary;
}
