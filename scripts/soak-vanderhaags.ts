import { VanderHaagsCursor } from "../src/server/ingestion/vanderhaags-cursor";
import type { VanderHaagsStreamResult } from "../src/server/ingestion/vanderhaags-connector";

/** Run bounded production checkpoints, counting and discarding donor batches. */
export async function soakVanderHaagsInventory(
  runChunk: (
    cursor: VanderHaagsCursor,
    maxPages: number,
  ) => Promise<VanderHaagsStreamResult>,
  maxPages = 10_000,
): Promise<VanderHaagsStreamResult> {
  const summary: VanderHaagsStreamResult = {
    source: "vanderhaags",
    status: "paused",
    cursor: VanderHaagsCursor.initial,
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
  while (summary.pagesProcessed < maxPages) {
    const chunk = await runChunk(
      summary.cursor,
      Math.min(12, maxPages - summary.pagesProcessed),
    );
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(chunk.cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "VanderHaags soak made no progress; inspect the last checkpoint before retrying",
      );
    summary.count += chunk.count;
    summary.pagesProcessed += chunk.pagesProcessed;
    summary.errors.push(...chunk.errors);
    summary.warnings?.push(...(chunk.warnings ?? []));
    for (const vin of chunk.observedVins ?? []) observedVins.add(vin);
    if (summary.accounting && chunk.accounting) {
      summary.accounting.recordsProcessed += chunk.accounting.recordsProcessed;
      summary.accounting.recordsExcluded += chunk.accounting.recordsExcluded;
      summary.accounting.recordsRejected += chunk.accounting.recordsRejected;
      summary.accounting.duplicateVehicles +=
        chunk.accounting.duplicateVehicles;
    }
    summary.cursor = chunk.cursor;
    summary.status = chunk.status;
    summary.observedVins = [...observedVins];
    console.log(
      "[soak] vanderhaags details=" +
        summary.pagesProcessed +
        " phase=" +
        chunk.cursor.phase +
        " vehicles=" +
        summary.count +
        " status=" +
        chunk.status,
    );
    if (chunk.status !== "paused") return summary;
  }
  return summary;
}
