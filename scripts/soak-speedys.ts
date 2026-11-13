import {
  SpeedysCursor,
  SpeedysCursorSchema,
} from "../src/server/ingestion/speedys-cursor";
import type { SpeedysStreamResult } from "../src/server/ingestion/speedys-connector";

/** Count and discard callbacks in the caller; this harness has no persistence. */
export async function soakSpeedysInventory(
  runChunk: (
    cursor: SpeedysCursor,
    maxPages: number,
  ) => Promise<SpeedysStreamResult>,
  maxPages = 1000,
): Promise<SpeedysStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1)
    throw new Error(
      "Speedys soak requires a positive integer request-unit budget",
    );
  const summary: SpeedysStreamResult = {
    source: "speedys",
    status: "paused",
    cursor: SpeedysCursor.initial,
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
    const budget = Math.min(8, maxPages - summary.pagesProcessed);
    const chunk = await runChunk(summary.cursor, budget);
    const serialized: unknown = JSON.parse(JSON.stringify(chunk.cursor));
    const cursor = SpeedysCursorSchema.parse(serialized);
    if (
      chunk.source !== "speedys" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 0 ||
      chunk.pagesProcessed > budget ||
      (chunk.status === "complete") !== (cursor.phase === "complete") ||
      (chunk.status === "paused" &&
        (chunk.pagesProcessed === 0 ||
          JSON.stringify(cursor) === JSON.stringify(summary.cursor)))
    )
      throw new Error(
        "Speedys soak made no valid progress; retain the last validated checkpoint and inspect the source",
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
    summary.cursor = cursor;
    summary.status = chunk.status;
    summary.observedVins = [...observed];
    if (chunk.status !== "paused") break;
  }
  return summary;
}
