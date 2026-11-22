import {
  JolietCursor,
  JolietCursorSchema,
} from "../src/server/ingestion/joliet-cursor";
import type { JolietStreamResult } from "../src/server/ingestion/joliet-connector";
import { JOLIET_MAX_QUERIES } from "../src/server/ingestion/joliet-parser";

/** Read-only driver. Caller stages batches and owns the provider request gate. */
export async function soakJolietInventory(
  runChunk: (
    cursor: JolietCursor,
    maxPages: number,
  ) => Promise<JolietStreamResult>,
  maxPages = JOLIET_MAX_QUERIES,
): Promise<JolietStreamResult> {
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > JOLIET_MAX_QUERIES
  )
    throw new Error("Joliet soak requires a total query budget from 1 to 2000");
  const summary: JolietStreamResult = {
    source: "joliet",
    status: "paused",
    cursor: JolietCursor.initial,
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
    const cursor = JolietCursorSchema.parse(chunk.cursor);
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "Joliet soak made no query progress; retain the last checkpoint and inspect the native source",
      );
    if ((chunk.status === "complete") !== (cursor.phase === "complete"))
      throw new Error(
        "Joliet soak status disagrees with terminal cursor evidence",
      );
    // A restarted crawl supersedes every earlier chunk's inventory.
    if (chunk.restart) {
      summary.count = 0;
      observed.clear();
      if (summary.accounting)
        summary.accounting = {
          recordsProcessed: 0,
          recordsExcluded: 0,
          recordsRejected: 0,
          duplicateVehicles: 0,
        };
    }
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
