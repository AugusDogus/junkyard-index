/**
 * Standalone script to run the ingestion pipeline locally.
 * Usage: bun scripts/run-ingestion.ts
 *
 * Temporarily patches server-only to be a no-op, then runs ingestion.
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
  // Now load env and modules
  await import("dotenv/config");
  const { runIngestion } = await import("../src/server/ingestion/run");

  console.log("Starting ingestion pipeline...");
  console.log(
    "Turso:",
    process.env.TURSO_DATABASE_URL?.substring(0, 40) + "...",
  );
  console.log("Algolia App:", process.env.NEXT_PUBLIC_ALGOLIA_APP_ID);
  console.log("");

  const result = await runIngestion();
  console.log("\n=== INGESTION COMPLETE ===");
  console.log(`PYP vehicles: ${result.pypCount}`);
  console.log(`Row52 vehicles: ${result.row52Count}`);
  console.log(`Total upserted: ${result.totalUpserted}`);
  console.log(`Stale deleted: ${result.totalDeleted}`);
  console.log(`Duration: ${result.durationMs}ms`);
  if (result.errors.length > 0) {
    console.log(`Errors (${result.errors.length}):`);
    result.errors.slice(0, 10).forEach((e) => console.log(`  - ${e}`));
    if (result.errors.length > 10)
      console.log(`  ... and ${result.errors.length - 10} more`);
  }
} catch (error) {
  console.error("Ingestion failed:", error);
  process.exitCode = 1;
} finally {
  // Restore server-only guard
  writeFileSync(serverOnlyPath, originalContent);
}
