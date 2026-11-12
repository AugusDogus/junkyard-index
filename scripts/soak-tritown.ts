import { TritownCursor } from "../src/server/ingestion/tritown-cursor";
import type { TritownStreamResult } from "../src/server/ingestion/tritown-connector";

/** The caller counts/discards batches; this driver has no database or Blob access. */
export async function soakTritownInventory(
  runChunk: (
    cursor: TritownCursor,
    maxPages: number,
  ) => Promise<TritownStreamResult>,
  maxPages = 2_000,
): Promise<TritownStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 2_000)
    throw new Error("TriTown soak requires a page budget from 1 to 2000");
  const summary: TritownStreamResult = {
    source: "tritown",
    status: "paused",
    cursor: TritownCursor.initial,
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
      Math.min(16, maxPages - summary.pagesProcessed),
    );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(chunk.cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "TriTown soak made no progress; retain the last checkpoint and inspect the native source",
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
