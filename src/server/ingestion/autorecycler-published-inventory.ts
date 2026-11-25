import { and, count, eq, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";
import type { CanonicalVehicle } from "./types";
import { SourceValidationPolicy } from "./source-validation";
import {
  ARIO_CUSTOMER_YARDS,
  arioLocationCode,
  AUTORECYCLER_LOOKUP_PREFIX,
} from "./autorecycler-ario-yards";

// Protect current customer retirements without counting the intentionally removed
// LKQ mirrors and unsupported legacy yards in the initial migration baseline.
const customerYards = new Set([
  ...ARIO_CUSTOMER_YARDS.map(arioLocationCode),
  `${AUTORECYCLER_LOOKUP_PREFIX}1672882562847x152496749538181120`, // A-1 Metals
  `${AUTORECYCLER_LOOKUP_PREFIX}1727808874603x499378618447920300`, // JDM
]);

/** Check each eligible yard and bound stale customer removals against the prior
 * published customer inventory, using the existing 50% drift policy. */
export async function validateAutorecyclerPublishedInventory(
  database: LibSQLDatabase,
  current: Iterable<CanonicalVehicle>,
  eligibleYards: readonly string[],
  preservedYards: readonly string[] = [],
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
  let previousCustomerCount = 0;
  let newlyStaleCount = 0;
  const preserved = new Set(preservedYards);
  for (const yard of previous) {
    if (preserved.has(yard.code)) continue;
    if (eligible.has(yard.code) || customerYards.has(yard.code)) {
      previousCustomerCount += yard.count;
      if (!eligible.has(yard.code)) newlyStaleCount += yard.count;
    }
    if (!eligible.has(yard.code)) continue;
    previousEligibleCount += yard.count;
    const accepted = counts.get(yard.code) ?? 0;
    if (accepted < yard.count * SourceValidationPolicy.minimumPreviousRunRatio)
      errors.push(
        `AutoRecycler ${yard.code} inventory fell from ${yard.count} to ${accepted}, below the 50% yard drift limit. Previously published inventory is preserved; inspect the complete yard catalog before retrying.`,
      );
  }
  if (
    newlyStaleCount >
    previousCustomerCount * (1 - SourceValidationPolicy.minimumPreviousRunRatio)
  )
    errors.push(
      `AutoRecycler stale yards would remove ${newlyStaleCount} of ${previousCustomerCount} previously published customer vehicles, exceeding the 50% stale-yard removal limit. Published inventory is preserved; inspect addition dates and confirm yard retirements before retrying.`,
    );
  return { previousEligibleCount, errors: [...new Set(errors)] };
}
