import { YardService } from "~/lib/yard-service";
import { inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { FirstSighting } from "~/lib/first-sighting";
import { getYardDetails } from "~/lib/yard-details";
import { vehicle, yard, yardArrivalBaseline } from "~/schema";
import { mapDbVehicleToAlgolia } from "./algolia-projector-helpers";

/**
 * Use the same metadata and legacy fallback as yard pages, once per batch.
 * Classifies each vehicle against its yard's arrival baseline, which the
 * publishing run writes in the same transaction that publishes it, so a
 * record projected after publication always sees its yard's baseline.
 */
export async function projectSearchVehicles(
  database: LibSQLDatabase,
  rows: (typeof vehicle.$inferSelect)[],
) {
  if (!rows.length) return [];
  const sources = [...new Set(rows.map((row) => row.source))];
  const metadata = await database
    .select()
    .from(yard)
    .where(inArray(yard.source, sources));
  const byYard = new Map(
    metadata.map((yard) => [JSON.stringify([yard.source, yard.code]), yard]),
  );
  const baselines = await database
    .select()
    .from(yardArrivalBaseline)
    .where(inArray(yardArrivalBaseline.source, sources));
  const establishedAt = new Map(
    baselines.map((baseline) => [
      JSON.stringify([baseline.source, baseline.locationCode]),
      baseline.establishedAt,
    ]),
  );
  return rows.map((row) => {
    const yardKey = JSON.stringify([row.source, row.locationCode]);
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
      byYard.get(yardKey) ?? null,
    );
    return {
      ...mapDbVehicleToAlgolia(row),
      locationName: details.name,
      yardServiceType: details.service.kind,
      yardTypes: YardService.types(details.service),
      firstSighting: FirstSighting.of(
        row.firstSeenAt,
        establishedAt.get(yardKey) ?? null,
      ),
    };
  });
}
