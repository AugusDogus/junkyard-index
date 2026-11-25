import { YardService } from "~/lib/yard-service";
import { and, eq, inArray, or } from "drizzle-orm";
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
  // most sources, so about 1-2.5K yard rows per batch. One OR term per
  // source keeps the expression shallow (SQLite allows a depth of 1,000)
  // however many yards a 5,000-change projector batch lists.
  const codesBySource = new Map<string, Set<string>>();
  for (const row of rows) {
    const codes = codesBySource.get(row.source) ?? new Set<string>();
    codes.add(row.locationCode);
    codesBySource.set(row.source, codes);
  }
  const metadata = await database
    .select()
    .from(yard)
    .where(
      or(
        ...[...codesBySource].map(([source, codes]) =>
          and(eq(yard.source, source), inArray(yard.code, [...codes])),
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
