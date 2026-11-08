import { and, asc, eq, getTableColumns } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getYardDetails } from "~/lib/yard-details";
import { yardInventory, yard as yardTable } from "~/schema";

/** One row per yard with live vehicles, maintained by ingestion. */
export async function getHomepageYards(database: LibSQLDatabase) {
  const yards = await database
    .select({
      source: yardInventory.source,
      code: yardInventory.locationCode,
      name: yardInventory.locationName,
      city: yardInventory.locationCity,
      state: yardInventory.stateAbbr,
      lat: yardInventory.lat,
      lng: yardInventory.lng,
      vehicleCount: yardInventory.vehicleCount,
      inventoryUrl: yardInventory.inventoryUrl,
      metadata: getTableColumns(yardTable),
    })
    .from(yardInventory)
    .leftJoin(
      yardTable,
      and(
        eq(yardTable.source, yardInventory.source),
        eq(yardTable.code, yardInventory.locationCode),
      ),
    )
    .orderBy(asc(yardInventory.stateAbbr), asc(yardInventory.locationName));
  return yards.map(({ metadata, inventoryUrl, ...yard }) => ({
    ...yard,
    ...getYardDetails({ ...yard, inventoryUrl }, metadata),
  }));
}
