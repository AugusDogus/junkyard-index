import { MichigantruckCursor } from "../src/server/ingestion/michigantruck-cursor";
import { MICHIGANTRUCK_MAX_PAGES } from "../src/server/ingestion/michigantruck-parser";
import type { MichigantruckStreamResult } from "../src/server/ingestion/michigantruck-connector";

/** Count/discard callback only. This driver has no database or Blob access. */
export async function soakMichigantruckInventory(
  runChunk: (
    cursor: MichigantruckCursor,
    maxPages: number,
  ) => Promise<MichigantruckStreamResult>,
  maxPages = MICHIGANTRUCK_MAX_PAGES,
): Promise<MichigantruckStreamResult> {
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > MICHIGANTRUCK_MAX_PAGES
  )
    throw new Error(
      `Michigan Truck soak requires a 1-${MICHIGANTRUCK_MAX_PAGES} new catalog page budget`,
    );
  const summary: MichigantruckStreamResult = {
    source: "michigantruck",
    status: "paused",
    cursor: MichigantruckCursor.initial,
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
    const chunk = await runChunk(summary.cursor, 1);
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(chunk.cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "Michigan Truck soak made no progress; retain the last validated checkpoint and inspect the source",
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
