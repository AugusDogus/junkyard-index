import { and, count, eq, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";

/** Completed snapshots are cleaned up, so use the currently persisted,
 * non-missing yard inventory as the durable per-yard drift baseline. */
export async function validateCars4PartsPublishedYardInventory(
  database: LibSQLDatabase,
  current: Iterable<CanonicalVehicle>,
): Promise<string[]> {
  const previous = await database
    .select({ code: vehicle.locationCode, count: count() })
    .from(vehicle)
    .where(
      and(eq(vehicle.source, "cars4parts"), isNull(vehicle.missingSinceAt)),
    )
    .groupBy(vehicle.locationCode);
  const counts = new Map<string, number>();
  for (const donor of current)
    counts.set(donor.locationCode, (counts.get(donor.locationCode) ?? 0) + 1);
  return previous.flatMap((yard) => {
    const accepted = counts.get(yard.code) ?? 0;
    return accepted <
      yard.count * SourceValidationPolicy.minimumPreviousRunRatio
      ? [
          `cars4parts ${yard.code} inventory fell from ${yard.count} to ${accepted}, below the 50% yard drift limit; previously published inventory is preserved. Inspect the complete yard catalog before retrying.`,
        ]
      : [];
  });
}
