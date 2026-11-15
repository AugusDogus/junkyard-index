import {
  UrgiisCursor,
  URGIIS_MAX_REQUESTS,
} from "../src/server/ingestion/urgiis-cursor";
import type { UrgiisStreamResult } from "../src/server/ingestion/urgiis-connector";

/** Count-only run through checked serialized checkpoints. No database writes. */
export async function soakUrgiisInventory(
  runChunk: (
    cursor: UrgiisCursor,
    maxPages: number,
  ) => Promise<UrgiisStreamResult>,
  maxRequests = URGIIS_MAX_REQUESTS,
): Promise<UrgiisStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("URG IIS soak needs a positive request budget");
  let cursor = UrgiisCursor.initial();
  let pagesProcessed = 0;
  let count = 0;
  const accounting = {
    recordsProcessed: 0,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  const warnings: string[] = [];
  while (pagesProcessed < maxRequests) {
    const chunk = await runChunk(
      cursor,
      Math.min(3, maxRequests - pagesProcessed),
    );
    const next = UrgiisCursor.fromWire(UrgiisCursor.serialize(chunk.cursor));
    if (
      chunk.status === "paused" &&
      next.requests <= cursor.requests &&
      next.completed.length <= cursor.completed.length
    )
      throw new Error(
        "URG IIS soak made no progress; retain the last validated checkpoint",
      );
    cursor = next;
    pagesProcessed += chunk.pagesProcessed;
    count += chunk.count;
    warnings.push(...chunk.warnings);
    for (const k of [
      "recordsProcessed",
      "recordsExcluded",
      "recordsRejected",
      "duplicateVehicles",
    ] as const)
      accounting[k] += chunk.accounting[k];
    if (chunk.status === "complete" || pagesProcessed === maxRequests)
      return { ...chunk, cursor, pagesProcessed, count, accounting, warnings };
  }
  throw new Error("URG IIS soak exhausted its budget without a result");
}
