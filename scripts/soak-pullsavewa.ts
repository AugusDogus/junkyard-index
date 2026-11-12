import { PullsavewaCursor } from "../src/server/ingestion/pullsavewa-cursor";
import type { PullsavewaStreamResult } from "../src/server/ingestion/pullsavewa-connector";

/** Count/discard batches in the caller. This driver has no database or Blob access. */
export async function soakPullsavewaInventory(
  runChunk: (
    cursor: PullsavewaCursor,
    maxPages: number,
  ) => Promise<PullsavewaStreamResult>,
  maxPages = 2,
): Promise<PullsavewaStreamResult> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 2)
    throw new Error(
      "Pull & Save soak requires a yard snapshot budget from 1 to 2",
    );
  const summary: PullsavewaStreamResult = {
    source: "pullsavewa",
    status: "paused",
    cursor: PullsavewaCursor.initial,
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
        "Pull & Save soak made no progress; retain the last checkpoint and inspect the native yard catalog",
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
