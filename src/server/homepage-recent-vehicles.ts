import { and, asc, desc, eq, gt, isNull } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle, yardArrivalBaseline } from "~/schema";

const RECENT_VEHICLE_LIMIT = 12;

/**
 * Newest vehicles by first sighting. A yard's first crawl is its existing
 * backlog, not new arrivals, so only cars first seen after that crawl count.
 */
export async function getRecentHomepageVehicles(database: LibSQLDatabase) {
  const rows = await database
    .select({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      city: vehicle.locationCity,
      state: vehicle.stateAbbr,
      imageUrl: vehicle.imageUrl,
      indexedAt: vehicle.firstSeenAt,
    })
    .from(vehicle)
    .innerJoin(
      yardArrivalBaseline,
      and(
        eq(yardArrivalBaseline.source, vehicle.source),
        eq(yardArrivalBaseline.locationCode, vehicle.locationCode),
      ),
    )
    .where(
      and(
        isNull(vehicle.missingSinceAt),
        gt(vehicle.firstSeenAt, yardArrivalBaseline.establishedAt),
      ),
    )
    .orderBy(desc(vehicle.firstSeenAt), asc(vehicle.vin))
    .limit(RECENT_VEHICLE_LIMIT);
  return rows.map((entry) => ({
    ...entry,
    indexedAt: entry.indexedAt.toISOString(),
  }));
}
