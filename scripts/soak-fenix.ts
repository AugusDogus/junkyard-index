import type { FenixStreamResult } from "../src/server/ingestion/fenix-connector";
import {
  FenixCursor,
  FenixCursorSchema,
} from "../src/server/ingestion/fenix-cursor";

/** Count and discard donors through the caller's gated connector. No writes. */
export async function soakFenixInventory(
  runChunk: (
    cursor: FenixCursor,
    maxPages: number,
  ) => Promise<FenixStreamResult>,
  maxPages = 2000,
): Promise<FenixStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 3)
    throw new Error(
      "Fenix soak requires at least three HTTP requests per source budget",
    );
  const summary: FenixStreamResult = {
    source: "fenix",
    status: "paused",
    cursor: FenixCursor.initial,
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
  while (maxPages - summary.pagesProcessed >= 3) {
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
        "Fenix soak made no progress; inspect the last validated checkpoint before retrying",
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
    // Exercise the same serialized boundary as durable orchestration.
    summary.cursor = FenixCursorSchema.parse(
      JSON.parse(JSON.stringify(chunk.cursor)),
    );
    summary.status = chunk.status;
    summary.observedVins = [...observedVins];
    console.log(
      `[soak] fenix requests=${summary.pagesProcessed} phase=${summary.cursor.phase} vehicles=${summary.count} status=${summary.status}`,
    );
    if (summary.status !== "paused") break;
  }
  return summary;
}
