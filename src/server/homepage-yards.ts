import { and, asc, count, eq, getTableColumns, isNull, min } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getYardDetails } from "~/lib/yard-details";
import { YardPath } from "~/lib/yard-path";
import { vehicle, yard as yardTable } from "~/schema";

export async function getHomepageYards(database: LibSQLDatabase) {
  const yards = await database
    .select({
      source: vehicle.source,
      code: vehicle.locationCode,
      name: vehicle.locationName,
      city: vehicle.locationCity,
      state: vehicle.stateAbbr,
      lat: vehicle.lat,
      lng: vehicle.lng,
      vehicleCount: count(),
      inventoryUrl: min(vehicle.detailsUrl),
      metadata: getTableColumns(yardTable),
    })
    .from(vehicle)
    .leftJoin(
      yardTable,
      and(
        eq(yardTable.source, vehicle.source),
        eq(yardTable.code, vehicle.locationCode),
      ),
    )
    .where(isNull(vehicle.missingSinceAt))
    .groupBy(vehicle.source, vehicle.locationCode)
    .orderBy(asc(vehicle.stateAbbr), asc(vehicle.locationName));
  const detailed = yards.map(({ metadata, inventoryUrl, ...yard }) => ({
    ...yard,
    ...getYardDetails({ ...yard, inventoryUrl }, metadata),
  }));
  const paths = YardPath.assign(detailed);
  return detailed.map((yard) => ({
    ...yard,
    path: paths.get(YardPath.key(yard)) ?? null,
  }));
}
