import { UwrenchCursor } from "../src/server/ingestion/uwrench-cursor";
import { UWRENCH_MAX_QUERIES } from "../src/server/ingestion/uwrench-parser";
import type { UwrenchStreamResult } from "../src/server/ingestion/uwrench-connector";

/** Read-only driver; the caller owns transport, batch staging and admission. */
export async function soakUwrenchInventory(
  runChunk: (
    cursor: UwrenchCursor,
    maxPages: number,
  ) => Promise<UwrenchStreamResult>,
  maxPages = 2 * UWRENCH_MAX_QUERIES,
): Promise<UwrenchStreamResult> {
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 2 * UWRENCH_MAX_QUERIES
  )
    throw new Error(
      "Tri-State soak requires a total scan/verification selector budget from 1 through 4000",
    );
  const summary: UwrenchStreamResult = {
    source: "uwrench",
    status: "paused",
    cursor: UwrenchCursor.initial,
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
  const presence = new Set<string>();
  while (summary.pagesProcessed < maxPages) {
    const chunk = await runChunk(
      summary.cursor,
      Math.min(16, maxPages - summary.pagesProcessed),
    );
    const wire = UwrenchCursor.serialize(chunk.cursor);
    const cursor = UwrenchCursor.parse(wire);
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        wire === UwrenchCursor.serialize(summary.cursor))
    )
      throw new Error(
        "Tri-State soak made no query progress; prior checkpoint remains intact",
      );
    if ((chunk.status === "complete") !== (cursor.phase === "complete"))
      throw new Error(
        "Tri-State soak status disagrees with terminal cursor evidence",
      );
    summary.count += chunk.count;
    summary.pagesProcessed += chunk.pagesProcessed;
    summary.errors.push(...chunk.errors);
    summary.warnings = [...new Set([...summary.warnings, ...chunk.warnings])];
    for (const vin of chunk.observedVins) presence.add(vin);
    summary.accounting.recordsProcessed += chunk.accounting.recordsProcessed;
    summary.accounting.recordsExcluded += chunk.accounting.recordsExcluded;
    summary.accounting.recordsRejected += chunk.accounting.recordsRejected;
    summary.accounting.duplicateVehicles += chunk.accounting.duplicateVehicles;
    summary.observedVins = [...presence];
    summary.cursor = cursor;
    summary.status = chunk.status;
    if (chunk.status === "complete") break;
  }
  return summary;
}
