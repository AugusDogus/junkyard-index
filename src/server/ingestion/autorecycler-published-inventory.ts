import { and, count, eq, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";
import type { CanonicalVehicle } from "./types";
import { SourceValidationPolicy } from "./source-validation";

/** Stale/excluded yards intentionally disappear. Compare only eligible yards,
 * including eligible yards that emitted zero rows, so outages still fail shut. */
export async function validateAutorecyclerPublishedInventory(
  database: LibSQLDatabase,
  current: Iterable<CanonicalVehicle>,
  eligibleYards: readonly string[],
): Promise<{ previousEligibleCount: number; errors: string[] }> {
  const eligible = new Set(eligibleYards);
  const counts = new Map<string, number>();
  const errors: string[] = [];
  for (const donor of current) {
    if (!eligible.has(donor.locationCode))
      errors.push(
        `AutoRecycler emitted ineligible yard ${donor.locationCode}; restart the source with a fresh yard census`,
      );
    counts.set(donor.locationCode, (counts.get(donor.locationCode) ?? 0) + 1);
  }
  const previous = await database
    .select({ code: vehicle.locationCode, count: count() })
    .from(vehicle)
    .where(
      and(eq(vehicle.source, "autorecycler"), isNull(vehicle.missingSinceAt)),
    )
    .groupBy(vehicle.locationCode);
  let previousEligibleCount = 0;
  for (const yard of previous) {
    if (!eligible.has(yard.code)) continue;
    previousEligibleCount += yard.count;
    const accepted = counts.get(yard.code) ?? 0;
    if (accepted < yard.count * SourceValidationPolicy.minimumPreviousRunRatio)
      errors.push(
        `AutoRecycler ${yard.code} inventory fell from ${yard.count} to ${accepted}, below the 50% yard drift limit. Previously published inventory is preserved; inspect the complete yard catalog before retrying.`,
      );
  }
  return { previousEligibleCount, errors: [...new Set(errors)] };
}
