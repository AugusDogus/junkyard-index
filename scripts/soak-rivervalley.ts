import { RivervalleyCursor } from "../src/server/ingestion/rivervalley-cursor";
import type { RivervalleyStreamResult } from "../src/server/ingestion/rivervalley-connector";

/** Count/discard driver with no database, search-index, alert or photo writes. */
export async function soakRivervalleyInventory(
  runChunk: (
    cursor: RivervalleyCursor,
    maxPages: number,
  ) => Promise<RivervalleyStreamResult>,
  maxPages = 1_000,
): Promise<RivervalleyStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 2 || maxPages > 10_000)
    throw new Error(
      "River Valley soak requires a budget of 2-10000 HTTP requests",
    );
  const summary: RivervalleyStreamResult = {
    source: "rivervalley",
    status: "paused",
    cursor: RivervalleyCursor.initial,
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
  while (maxPages - summary.pagesProcessed >= 2) {
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
        "River Valley soak made no progress; retain the last checkpoint and inspect the native source",
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
