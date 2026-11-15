import { PickNSaveCursor } from "../src/server/ingestion/picknsave-cursor";
import type { PickNSaveStreamResult } from "../src/server/ingestion/picknsave-connector";

/** Exercise the actual two-page checkpoints instead of extending their timeout. */
export async function soakPickNSaveInventory(
  runChunk: (
    cursor: PickNSaveCursor,
    maxPages: number,
  ) => Promise<PickNSaveStreamResult>,
  maxPages = 400,
): Promise<PickNSaveStreamResult> {
  let cursor: PickNSaveCursor = PickNSaveCursor.initial;
  const summary: PickNSaveStreamResult = {
    source: "picknsave",
    status: "paused",
    cursor,
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
  while (summary.pagesProcessed < maxPages) {
    const result = await runChunk(
      cursor,
      Math.min(2, maxPages - summary.pagesProcessed),
    );
    summary.count += result.count;
    summary.pagesProcessed += result.pagesProcessed;
    summary.errors.push(...result.errors);
    summary.warnings = [
      ...(summary.warnings ?? []),
      ...(result.warnings ?? []),
    ];
    summary.observedVins = [
      ...new Set([
        ...(summary.observedVins ?? []),
        ...(result.observedVins ?? []),
      ]),
    ];
    if (summary.accounting && result.accounting) {
      summary.accounting.recordsProcessed += result.accounting.recordsProcessed;
      summary.accounting.recordsExcluded += result.accounting.recordsExcluded;
      summary.accounting.recordsRejected += result.accounting.recordsRejected;
      summary.accounting.duplicateVehicles +=
        result.accounting.duplicateVehicles;
    }
    summary.cursor = result.cursor;
    summary.status = result.status;
    console.log(
      `[soak] picknsave checkpoint pages=${summary.pagesProcessed} vehicles=${summary.count} status=${result.status}`,
    );
    if (result.status !== "paused") return summary;
    if (
      result.pagesProcessed === 0 ||
      JSON.stringify(result.cursor) === JSON.stringify(cursor)
    )
      throw new Error(
        "Pick-n-Save soak made no cursor progress; inspect the checkpoint before retrying",
      );
    cursor = result.cursor;
  }
  return summary;
}
