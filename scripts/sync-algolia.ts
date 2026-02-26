/**
 * Standalone script to sync Turso → Algolia without re-scraping.
 * Usage: bun scripts/sync-algolia.ts
 *
 * Reads all vehicles from Turso and pushes them to Algolia.
 * Useful when ingestion completed but the Algolia upload failed partway through.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Temporarily disable server-only guard
const serverOnlyPath = resolve(
  import.meta.dir,
  "../node_modules/server-only/index.js",
);
const originalContent = readFileSync(serverOnlyPath, "utf-8");
writeFileSync(serverOnlyPath, "// temporarily disabled for script\n");

try {
  await import("dotenv/config");

  const { db } = await import("../src/lib/db");
  const { vehicle } = await import("../schema");
  const { toAlgoliaRecord } = await import("../src/server/ingestion/types");
  const { syncToAlgolia } =
    await import("../src/server/ingestion/sync-algolia");

  console.log("Reading all vehicles from Turso...");
  const allDbVehicles = await db.select().from(vehicle);
  console.log(`Found ${allDbVehicles.length} vehicles in Turso`);

  console.log("Building Algolia records...");
  const algoliaRecords = allDbVehicles.map((dbVehicle) =>
    toAlgoliaRecord(
      {
        vin: dbVehicle.vin,
        source: dbVehicle.source as "pyp" | "row52",
        year: dbVehicle.year,
        make: dbVehicle.make,
        model: dbVehicle.model,
        color: dbVehicle.color,
        stockNumber: dbVehicle.stockNumber,
        imageUrl: dbVehicle.imageUrl,
        availableDate: dbVehicle.availableDate,
        locationCode: dbVehicle.locationCode,
        locationName: dbVehicle.locationName,
        state: dbVehicle.state,
        stateAbbr: dbVehicle.stateAbbr,
        lat: dbVehicle.lat,
        lng: dbVehicle.lng,
        section: dbVehicle.section,
        row: dbVehicle.row,
        space: dbVehicle.space,
        detailsUrl: dbVehicle.detailsUrl,
        partsUrl: dbVehicle.partsUrl,
        pricesUrl: dbVehicle.pricesUrl,
        engine: dbVehicle.engine,
        trim: dbVehicle.trim,
        transmission: dbVehicle.transmission,
      },
      dbVehicle.firstSeenAt,
      dbVehicle.missingSinceAt,
      dbVehicle.missingRunCount ?? 0,
    ),
  );

  console.log(`Syncing ${algoliaRecords.length} records to Algolia...`);
  await syncToAlgolia(algoliaRecords, []);

  console.log("\n=== SYNC COMPLETE ===");
  console.log(`Total synced: ${algoliaRecords.length} vehicles`);
} catch (error) {
  console.error("Sync failed:", error);
  process.exitCode = 1;
} finally {
  writeFileSync(serverOnlyPath, originalContent);
}
