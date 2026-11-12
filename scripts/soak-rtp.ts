import { RtpCursor } from "../src/server/ingestion/rtp-cursor";
import type { RtpStreamResult } from "../src/server/ingestion/rtp-connector";

/** Exercise production-sized checkpoints without publishing inventory. */
export async function soakRtpInventory(
  runChunk: (cursor: RtpCursor, maxPages: number) => Promise<RtpStreamResult>,
  maxPages = 200,
): Promise<RtpStreamResult> {
  const summary: RtpStreamResult = {
    source: "rtp",
    status: "paused",
    cursor: RtpCursor.initial,
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
    const previous = summary.cursor;
    const chunk = await runChunk(
      previous,
      Math.min(2, maxPages - summary.pagesProcessed),
    );
    if (chunk.pagesProcessed === 0 && chunk.status === "paused")
      throw new Error(
        "RTP soak made no progress; inspect the checkpoint before retrying",
      );
    summary.count += chunk.count;
    summary.pagesProcessed += chunk.pagesProcessed;
    summary.errors.push(...chunk.errors);
    summary.warnings?.push(...(chunk.warnings ?? []));
    summary.observedVins = [
      ...new Set([
        ...(summary.observedVins ?? []),
        ...(chunk.observedVins ?? []),
      ]),
    ];
    if (summary.accounting && chunk.accounting) {
      summary.accounting.recordsProcessed += chunk.accounting.recordsProcessed;
      summary.accounting.recordsExcluded += chunk.accounting.recordsExcluded;
      summary.accounting.recordsRejected += chunk.accounting.recordsRejected;
      summary.accounting.duplicateVehicles +=
        chunk.accounting.duplicateVehicles;
    }
    summary.cursor = chunk.cursor;
    summary.status = chunk.status;
    console.log(
      `[soak] rtp checkpoint pages=${summary.pagesProcessed} vehicles=${summary.count} status=${chunk.status}`,
    );
    if (chunk.status !== "paused") return summary;
    if (JSON.stringify(previous) === JSON.stringify(chunk.cursor))
      throw new Error(
        "RTP soak cursor did not advance; inspect the checkpoint before retrying",
      );
  }
  return summary;
}
