import {
  createAlln1Cursor,
  type UpullCursor,
} from "../src/server/ingestion/alln1-cursor";
import type { UpullStreamResult } from "../src/server/ingestion/alln1-connector";
import {
  ALLN1_TENANT,
  ALLN1_MAX_PAGES,
  type Alln1Tenant,
  type Alln1Source,
} from "../src/server/ingestion/alln1-yard-metadata";

/** Read-only count/discard driver. Caller owns callbacks and request gate. */
export async function soakUpullInventory<S extends Alln1Source>(
  tenant: Alln1Tenant<S>,
  runChunk: (
    cursor: UpullCursor<S>,
    maxPages: number,
  ) => Promise<UpullStreamResult<S>>,
  maxPages = ALLN1_MAX_PAGES,
): Promise<UpullStreamResult<S>> {
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    maxPages > ALLN1_MAX_PAGES
  )
    throw new Error("All-N-1 soak requires a total page budget from 1 to 20");
  const codec = createAlln1Cursor(tenant);
  const summary: UpullStreamResult<S> = {
    source: tenant.source,
    status: "paused",
    cursor: codec.initial,
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
      Math.min(3, maxPages - summary.pagesProcessed),
    );
    const cursor = codec.schema.parse(chunk.cursor);
    if (
      chunk.status === "paused" &&
      (chunk.pagesProcessed === 0 ||
        JSON.stringify(cursor) === JSON.stringify(summary.cursor))
    )
      throw new Error(
        "All-N-1 soak made no page progress; inspect the source and retain the last checkpoint",
      );
    if ((chunk.status === "complete") !== (cursor.phase === "complete"))
      throw new Error(
        "All-N-1 soak status conflicts with terminal cursor evidence",
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
    summary.cursor = cursor;
    summary.status = chunk.status;
    summary.observedVins = [...observed];
    if (chunk.status !== "paused") break;
  }
  return summary;
}

export const soakAlln1Inventory = (
  runChunk: (
    cursor: UpullCursor<"alln1">,
    maxPages: number,
  ) => Promise<UpullStreamResult<"alln1">>,
  maxPages = ALLN1_MAX_PAGES,
) => soakUpullInventory(ALLN1_TENANT, runChunk, maxPages);
