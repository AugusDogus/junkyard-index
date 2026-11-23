import {
  UrgiisCursor,
  URGIIS_MAX_REQUESTS,
} from "../src/server/ingestion/urgiis-cursor";
import type { UrgiisStreamResult } from "../src/server/ingestion/urgiis-connector";
import { URGIIS_TENANTS } from "../src/server/ingestion/urgiis-configuration";
import type { UrgiisTenant } from "../src/server/ingestion/urgiis-tenant";

/** The configured tenants a comma-separated `--urgiis-tenants` value names,
 * in crawl order, so one browser tenant can be soaked without paying for the
 * others. */
export function urgiisSoakTenants(value: string): readonly UrgiisTenant[] {
  const codes = value.split(",").map((code) => code.trim());
  const unknown = codes.filter(
    (code) => !URGIIS_TENANTS.some((tenant) => tenant.code === code),
  );
  if (unknown.length > 0)
    throw new Error(
      `--urgiis-tenants names ${unknown.map((code) => JSON.stringify(code)).join(", ")}, which is not a configured URG IIS tenant. Use codes from ${URGIIS_TENANTS.map((tenant) => tenant.code).join(", ")}.`,
    );
  return URGIIS_TENANTS.filter((tenant) => codes.includes(tenant.code));
}

/** Count-only run through checked serialized checkpoints. No database writes. */
export async function soakUrgiisInventory(
  runChunk: (
    cursor: UrgiisCursor,
    maxPages: number,
    censusState?: unknown,
  ) => Promise<UrgiisStreamResult>,
  maxRequests = URGIIS_MAX_REQUESTS,
  tenants: readonly UrgiisTenant[] = URGIIS_TENANTS,
): Promise<UrgiisStreamResult> {
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1)
    throw new Error("URG IIS soak needs a positive request budget");
  let cursor = UrgiisCursor.initial(tenants);
  let pagesProcessed = 0;
  let censusState: unknown;
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
      censusState,
    );
    censusState = chunk.checkpointState ?? censusState;
    const next = UrgiisCursor.fromWire(
      UrgiisCursor.serialize(chunk.cursor, tenants),
      tenants,
    );
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
