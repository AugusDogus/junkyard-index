import { NvpapCursor } from "../src/server/ingestion/nvpap-cursor";
import type { NvpapStreamResult } from "../src/server/ingestion/nvpap-connector";

/** Exercise production-sized checkpoints without publishing inventory. */
export async function soakNvpapInventory(
  runChunk: (
    cursor: NvpapCursor,
    maxPages: number,
  ) => Promise<NvpapStreamResult>,
  maxPages = 432,
): Promise<NvpapStreamResult> {
  const summary: NvpapStreamResult = {
    source: "nvpap",
    status: "paused",
    cursor: NvpapCursor.initial,
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
    const previous = summary.cursor;
    const chunk = await runChunk(
      previous,
      Math.min(16, maxPages - summary.pagesProcessed),
    );
    if (chunk.pagesProcessed === 0 && chunk.status === "paused")
      throw new Error(
        "Nevada soak made no progress; inspect the checkpoint before retrying",
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
      "[soak] nvpap checkpoint queries=" +
        summary.pagesProcessed +
        " vehicles=" +
        summary.count +
        " status=" +
        chunk.status,
    );
    if (chunk.status !== "paused") return summary;
    if (JSON.stringify(previous) === JSON.stringify(chunk.cursor))
      throw new Error(
        "Nevada soak cursor did not advance; inspect the checkpoint before retrying",
      );
  }
  return summary;
}
