import type { Six03StreamResult } from "../src/server/ingestion/six03-connector";
import { Six03Cursor } from "../src/server/ingestion/six03-cursor";

/** Count/discard only. The caller owns transport, staging and source admission. */
export async function soakSix03Inventory(
  runChunk: (
    cursor: Six03Cursor,
    maxPages: number,
  ) => Promise<Six03StreamResult>,
  maxPages = 1210,
  chunkPages = 8,
): Promise<Six03StreamResult> {
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > 1210 ||
    !Number.isSafeInteger(chunkPages) ||
    chunkPages < 1 ||
    chunkPages > 8
  )
    throw new Error(
      "603 soak requires 1-1210 total native GET units and 1-8 units per chunk",
    );
  const summary: Six03StreamResult = {
    source: "six03",
    status: "paused",
    cursor: Six03Cursor.initial,
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
    const requestBudget = Math.min(
      chunkPages,
      maxPages - summary.pagesProcessed,
    );
    const chunk = await runChunk(summary.cursor, requestBudget);
    const cursor = Six03Cursor.parse(Six03Cursor.serialize(chunk.cursor));
    if (
      chunk.source !== "six03" ||
      chunk.status === "failed" ||
      !Number.isSafeInteger(chunk.pagesProcessed) ||
      chunk.pagesProcessed < 1 ||
      chunk.pagesProcessed > requestBudget ||
      (chunk.status === "complete") !== (cursor.phase === "complete")
    )
      throw new Error(
        "603 soak status conflicts with its validated checkpoint; retain prior inventory",
      );
    if (
      chunk.status === "paused" &&
      (chunk.count !== 0 ||
        chunk.observedVins.length !== 0 ||
        Object.values(chunk.accounting).some((value) => value !== 0) ||
        summary.cursor.phase === "complete" ||
        cursor.phase === "complete" ||
        cursor.requests - summary.cursor.requests !== chunk.pagesProcessed)
    )
      throw new Error(
        "603 paused soak emitted preterminal data or changed native request accounting; retain the previous checkpoint",
      );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "603 soak made no native request progress; retain the previous checkpoint",
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
