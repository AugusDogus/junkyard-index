import { and, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";
import { mapDbVehicleToCanonical } from "./algolia-projector-helpers";
import {
  canonicalizeVinVehicles,
  rememberModelRedirects,
} from "./vin-canonicalization";

/** Taxonomy-only updates, guarded against a concurrent ingestion publication. */
export async function backfillVinVehicles(
  database: LibSQLDatabase,
  rows: (typeof vehicle.$inferSelect)[],
) {
  if (!rows.length) return [];
  const canonical = await canonicalizeVinVehicles(
    database,
    rows.map(mapDbVehicleToCanonical),
  );
  const updates = rows.flatMap((row, index) => {
    const next = canonical[index];
    if (
      !next ||
      (row.make === next.make &&
        row.model === next.model &&
        row.sourceMake === next.sourceMake &&
        row.sourceModel === next.sourceModel &&
        row.trim === next.trim)
    )
      return [];
    return [
      database
        .update(vehicle)
        .set({
          make: next.make,
          model: next.model,
          sourceMake: next.sourceMake,
          sourceModel: next.sourceModel,
          trim: next.trim,
        })
        .where(
          and(
            eq(vehicle.vin, row.vin),
            eq(vehicle.source, row.source),
            eq(vehicle.year, row.year),
            eq(vehicle.make, row.make),
            eq(vehicle.model, row.model),
            eq(vehicle.lastSeenAt, row.lastSeenAt),
          ),
        ),
    ];
  });
  const first = updates[0];
  if (first) await database.batch([first, ...updates.slice(1)]);
  const stored = await database
    .select()
    .from(vehicle)
    .where(
      inArray(
        vehicle.vin,
        rows.map((row) => row.vin),
      ),
    );
  await rememberModelRedirects(database, stored.map(mapDbVehicleToCanonical));
  return stored;
}
