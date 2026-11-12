import { UtpapCursor } from "../src/server/ingestion/utpap-cursor";
import type { UtpapStreamResult } from "../src/server/ingestion/utpap-connector";

/** Count and discard donors using the caller's local photo store. */
export async function soakUtpapInventory(
  runChunk: (
    cursor: UtpapCursor,
    maxPages: number,
  ) => Promise<UtpapStreamResult>,
  maxPages = 5_000,
): Promise<UtpapStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new Error("Utah soak requires a positive integer page-unit budget");
  const summary: UtpapStreamResult = {
    source: "utpap",
    status: "paused",
    cursor: UtpapCursor.initial,
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
  const observedVins = new Set<string>();
  while (summary.pagesProcessed < maxPages) {
    const chunk = await runChunk(
      summary.cursor,
      Math.min(16, maxPages - summary.pagesProcessed),
    );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(chunk.cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "Utah soak made no progress; inspect the last checkpoint before retrying",
      );
    summary.count += chunk.count;
    summary.pagesProcessed += chunk.pagesProcessed;
    summary.errors.push(...chunk.errors);
    summary.warnings = [
      ...new Set([...(summary.warnings ?? []), ...(chunk.warnings ?? [])]),
    ];
    for (const vin of chunk.observedVins ?? []) observedVins.add(vin);
    if (summary.accounting && chunk.accounting) {
      summary.accounting.recordsProcessed += chunk.accounting.recordsProcessed;
      summary.accounting.recordsExcluded += chunk.accounting.recordsExcluded;
      summary.accounting.recordsRejected += chunk.accounting.recordsRejected;
      summary.accounting.duplicateVehicles +=
        chunk.accounting.duplicateVehicles;
    }
    summary.cursor = chunk.cursor;
    summary.status = chunk.status;
    summary.observedVins = [...observedVins];
    console.log(
      `[soak] utpap units=${summary.pagesProcessed} phase=${chunk.cursor.phase} vehicles=${summary.count} status=${chunk.status}`,
    );
    if (chunk.status !== "paused") break;
  }
  return summary;
}
