import {
  LittletonCursor,
  LittletonCursorSchema,
} from "../src/server/ingestion/littleton-cursor";
import type { LittletonStreamResult } from "../src/server/ingestion/littleton-connector";
import { LITTLETON_MAX_QUERIES } from "../src/server/ingestion/littleton-parser";

/** Read-only driver. Caller stages/counts batches, and owns the request gate. */
export async function soakLittletonInventory(
  runChunk: (
    cursor: LittletonCursor,
    maxPages: number,
  ) => Promise<LittletonStreamResult>,
  maxPages = LITTLETON_MAX_QUERIES,
): Promise<LittletonStreamResult> {
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > LITTLETON_MAX_QUERIES
  )
    throw new Error("Littleton soak requires a query budget from 1 to 2000");
  const summary: LittletonStreamResult = {
    source: "littleton",
    status: "paused",
    cursor: LittletonCursor.initial,
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
    const cursor = LittletonCursorSchema.parse(chunk.cursor);
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "Littleton soak made no query progress; retain the last checkpoint and inspect the native source",
      );
    if ((chunk.status === "complete") !== (cursor.phase === "complete"))
      throw new Error(
        "Littleton soak status disagrees with terminal cursor evidence",
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
