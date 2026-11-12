import type { MccauleyStreamResult } from "../src/server/ingestion/mccauley-connector";
import {
  MccauleyCursor,
  MccauleyCursorSchema,
} from "../src/server/ingestion/mccauley-cursor";

/** Count/discard only. The caller owns transport, staging and source admission. */
export async function soakMccauleyInventory(
  runChunk: (
    cursor: MccauleyCursor,
    maxPages: number,
  ) => Promise<MccauleyStreamResult>,
  maxPages = 104,
  chunkPages = 8,
): Promise<MccauleyStreamResult> {
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 104 ||
    !Number.isSafeInteger(chunkPages) ||
    chunkPages < 1 ||
    chunkPages > 24
  )
    throw new Error(
      "McCauley soak requires 1-104 total native GET units and 1-24 units per chunk",
    );
  const summary: MccauleyStreamResult = {
    source: "mccauley",
    status: "paused",
    cursor: MccauleyCursor.initial,
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
      Math.min(chunkPages, maxPages - summary.pagesProcessed),
    );
    const cursor = MccauleyCursorSchema.parse(
      JSON.parse(JSON.stringify(chunk.cursor)),
    );
    if (
      chunk.status === "failed" ||
      (chunk.status === "complete") !== (cursor.phase === "complete")
    )
      throw new Error(
        "McCauley soak status conflicts with its validated checkpoint; retain prior inventory",
      );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "McCauley soak made no native request progress; retain the previous checkpoint",
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
    summary.observedVins = [...observed];
    summary.cursor = cursor;
    summary.status = chunk.status;
    if (chunk.status === "complete") break;
  }
  return summary;
}
