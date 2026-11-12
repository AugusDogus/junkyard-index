import { ImportapartCursor } from "../src/server/ingestion/importapart-cursor";
import type { ImportapartStreamResult } from "../src/server/ingestion/importapart-connector";

/** Count and discard callbacks in the caller; this harness has no persistence. */
export async function soakImportapartInventory(
  runChunk: (
    cursor: ImportapartCursor,
    maxPages: number,
  ) => Promise<ImportapartStreamResult>,
  maxPages = 1000,
): Promise<ImportapartStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new Error(
      "Importapart soak requires a positive integer request-unit budget",
    );
  const summary: ImportapartStreamResult = {
    source: "importapart",
    status: "paused",
    cursor: ImportapartCursor.initial,
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
        "Importapart soak made no progress; retain the last validated checkpoint and inspect the source",
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
