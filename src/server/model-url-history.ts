import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { InventorySnapshot } from "./inventory-snapshot";
import { vehicleModelRedirect } from "~/schema";

/** Capture preferred URLs before the first vehicle changes its taxonomy. */
export async function retainModelUrls(
  database: LibSQLDatabase,
): Promise<number> {
  const paths = await InventorySnapshot.modelUrls(database, "retained");
  const entries = paths.map((fromPath) => ({ fromPath, toPath: "" }));
  for (let start = 0; start < entries.length; start += 500) {
    await database
      .insert(vehicleModelRedirect)
      .values(entries.slice(start, start + 500))
      .onConflictDoNothing();
  }
  return paths.length;
}
