import { YardService } from "~/lib/yard-service";
import { and, eq, or } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { getYardDetails } from "~/lib/yard-details";
import { vehicle, yard } from "~/schema";
import { mapDbVehicleToAlgolia } from "./algolia-projector-helpers";

/** Use the same metadata and legacy fallback as yard pages, once per batch. */
export async function projectSearchVehicles(
  database: LibSQLDatabase,
  rows: (typeof vehicle.$inferSelect)[],
) {
  if (!rows.length) return [];
  // Each yard the batch lists, by primary key. Reading by source alone read
  // every yard of every source in the batch: a 100-VIN migration batch spans
  // most sources, so about 1-2.5K yard rows per batch.
  const yards = new Map(
    rows.map((row) => [
      JSON.stringify([row.source, row.locationCode]),
      { source: row.source, code: row.locationCode },
    ]),
  );
  const metadata = await database
    .select()
    .from(yard)
    .where(
      or(
        ...[...yards.values()].map(({ source, code }) =>
          and(eq(yard.source, source), eq(yard.code, code)),
        ),
      ),
    );
  const byYard = new Map(
    metadata.map((yard) => [JSON.stringify([yard.source, yard.code]), yard]),
  );
  return rows.map((row) => {
    const details = getYardDetails(
      {
        source: row.source,
        code: row.locationCode,
        name: row.locationName,
        city: row.locationCity ?? "Unknown",
        state: row.stateAbbr,
        lat: row.lat,
        lng: row.lng,
        inventoryUrl: row.detailsUrl,
      },
      byYard.get(JSON.stringify([row.source, row.locationCode])) ?? null,
    );
    return {
      ...mapDbVehicleToAlgolia(row),
      locationName: details.name,
      yardServiceType: details.service.kind,
      yardTypes: YardService.types(details.service),
    };
  });
}
