import { and, count, eq, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";

/** Completed snapshots are cleaned up, so use the currently persisted,
 * non-missing yard inventory as the durable per-yard drift baseline. Qualified
 * floors also protect smaller tenants after source-wide deduplication. */
export async function validatePublishedYardInventory(
  database: LibSQLDatabase,
  current: Iterable<CanonicalVehicle>,
  source: CanonicalVehicle["source"],
  minimumByYard: ReadonlyMap<string, number> = new Map(),
  preservedYards: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const previous = await database
    .select({ code: vehicle.locationCode, count: count() })
    .from(vehicle)
    .where(and(eq(vehicle.source, source), isNull(vehicle.missingSinceAt)))
    .groupBy(vehicle.locationCode);
  const counts = new Map<string, number>();
  for (const donor of current)
    counts.set(donor.locationCode, (counts.get(donor.locationCode) ?? 0) + 1);
  const floorErrors = [...minimumByYard].flatMap(([code, minimum]) => {
    const accepted = counts.get(code) ?? 0;
    return accepted < minimum
      ? [
          `${source} ${code} has ${accepted} donors, below its qualified yard floor ${minimum}; previously published inventory is preserved. Inspect the complete yard catalog before retrying.`,
        ]
      : [];
  });
  return [
    ...floorErrors,
    ...previous.flatMap((yard) => {
      if (preservedYards.has(yard.code)) return [];
      const accepted = counts.get(yard.code) ?? 0;
      return accepted <
        yard.count * SourceValidationPolicy.minimumPreviousRunRatio
        ? [
            `${source} ${yard.code} inventory fell from ${yard.count} to ${accepted}, below the 50% yard drift limit; previously published inventory is preserved. Inspect the complete yard catalog before retrying.`,
          ]
        : [];
    }),
  ];
}
