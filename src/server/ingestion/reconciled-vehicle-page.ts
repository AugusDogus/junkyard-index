import { and, asc, eq, gt } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";

/** The fields the missing phase reads for each existing vehicle. */
export type ReconciledVehicleRow = {
  vin: string;
  source: string;
  locationCode: string;
  missingSinceAt: Date | null;
  missingRunCount: number | null;
};

/**
 * Up to `limit` vehicles of `sources` after `cursor`, in VIN order.
 *
 * One query per source: `source = ? and vin > ? order by vin limit ?` walks
 * vehicle_source_vin_idx in order and stops at the limit. A single
 * `source in (...)` query cannot (SQLite sorts every remaining row of every
 * source in a temp B-tree to keep 500), so each page read the whole rest of
 * the source and a run's missing phase read about N^2/1000 rows: about 18M
 * a day on production in November 2026. The first `limit` of the merged
 * per-source pages are the first `limit` overall.
 */
export async function reconciledVehiclePage(
  database: LibSQLDatabase,
  sources: Iterable<string>,
  cursor: string | null,
  limit: number,
): Promise<ReconciledVehicleRow[]> {
  const pages = await Promise.all(
    [...new Set(sources)].map((source) =>
      database
        .select({
          vin: vehicle.vin,
          source: vehicle.source,
          locationCode: vehicle.locationCode,
          missingSinceAt: vehicle.missingSinceAt,
          missingRunCount: vehicle.missingRunCount,
        })
        .from(vehicle)
        .where(
          and(
            eq(vehicle.source, source),
            cursor === null ? undefined : gt(vehicle.vin, cursor),
          ),
        )
        .orderBy(asc(vehicle.vin))
        .limit(limit),
    ),
  );
  return pages
    .flat()
    .sort((a, b) => (a.vin < b.vin ? -1 : a.vin > b.vin ? 1 : 0))
    .slice(0, limit);
}
