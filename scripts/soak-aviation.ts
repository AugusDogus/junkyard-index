import {
  AviationCursor,
  AVIATION_MAX_REQUESTS,
} from "../src/server/ingestion/aviation-cursor";
import type { AviationStreamResult } from "../src/server/ingestion/aviation-connector";

/** Count/discard only. The caller owns transport, staging and source admission. */
export async function soakAviationInventory(
  runChunk: (
    cursor: AviationCursor,
    maxPages: number,
  ) => Promise<AviationStreamResult>,
  maxRequests = AVIATION_MAX_REQUESTS,
  chunkRequests = 8,
): Promise<AviationStreamResult> {
  if (
    !Number.isSafeInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > AVIATION_MAX_REQUESTS ||
    !Number.isSafeInteger(chunkRequests) ||
    chunkRequests < 1 ||
    chunkRequests > 8
  )
    throw new Error(
      "Aviation soak requires 1-650 total native requests and 1-8 requests per chunk",
    );
  const summary: AviationStreamResult = {
    source: "aviation",
    status: "paused",
    cursor: AviationCursor.initial,
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
  while (summary.pagesProcessed < maxRequests) {
    const budget = Math.min(
      chunkRequests,
      maxRequests - summary.pagesProcessed,
    );
    const chunk = await runChunk(summary.cursor, budget);
    const cursor = AviationCursor.parse(AviationCursor.serialize(chunk.cursor));
    if (
      chunk.status === "failed" ||
      (chunk.status === "complete") !== (cursor.phase === "complete") ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > budget
    )
      throw new Error(
        "Aviation soak status, request progress or terminal evidence is inconsistent",
      );
    if (
      chunk.status === "paused" &&
      (chunk.count !== 0 ||
        Object.values(chunk.accounting).some((count) => count !== 0) ||
        chunk.observedVins.length !== 0 ||
        JSON.stringify(cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "Aviation paused chunk emitted inventory/accounting or made no validated progress",
      );
    summary.count += chunk.count;
    summary.pagesProcessed += chunk.pagesProcessed;
    summary.errors.push(...chunk.errors);
    summary.warnings = [...new Set([...summary.warnings, ...chunk.warnings])];
    summary.observedVins = [
      ...new Set([...summary.observedVins, ...chunk.observedVins]),
    ];
    summary.accounting.recordsProcessed += chunk.accounting.recordsProcessed;
    summary.accounting.recordsExcluded += chunk.accounting.recordsExcluded;
    summary.accounting.recordsRejected += chunk.accounting.recordsRejected;
    summary.accounting.duplicateVehicles += chunk.accounting.duplicateVehicles;
    summary.cursor = cursor;
    summary.status = chunk.status;
    if (chunk.status === "complete") break;
  }
  return summary;
}
