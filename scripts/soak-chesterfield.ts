import { ChesterfieldCursor } from "../src/server/ingestion/chesterfield-cursor";
import type { ChesterfieldStreamResult } from "../src/server/ingestion/chesterfield-connector";

/** Count and discard canonical donors. The caller supplies memory-only photo storage. */
export async function soakChesterfieldInventory(
  runChunk: (
    cursor: ChesterfieldCursor,
    maxPages: number,
  ) => Promise<ChesterfieldStreamResult>,
  maxPages = 12_000,
): Promise<ChesterfieldStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 6)
    throw new Error(
      "Chesterfield soak requires at least six HTTP requests per source budget",
    );
  const summary: ChesterfieldStreamResult = {
    source: "chesterfield",
    status: "paused",
    cursor: ChesterfieldCursor.initial,
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
  while (maxPages - summary.pagesProcessed >= 6) {
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
        "Chesterfield soak made no progress; inspect the last checkpoint before retrying",
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
      `[soak] chesterfield requests=${summary.pagesProcessed} phase=${chunk.cursor.phase} vehicles=${summary.count} status=${chunk.status}`,
    );
    if (chunk.status !== "paused") break;
  }
  return summary;
}
