import { eq, like } from "drizzle-orm";
import { VehicleName } from "~/lib/vehicle-name";
import { ModelRedirect } from "~/lib/model-redirect";
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

/** Resolve old spellings through the same make/model identity used by pages. */
export async function findModelRedirect(
  database: LibSQLDatabase,
  path: string,
) {
  const parts = path.split("/");
  const make = parts[2];
  if (parts[1] !== "cars" || !make || parts.length > 4) return null;
  const normalizedMake = VehicleName.makeName(make);
  const makePath = `/cars/${VehicleName.slug(normalizedMake)}`;
  const model = parts[3];
  const normalizedPath = model
    ? ModelRedirect.path(normalizedMake, model.replace(/-/g, " "))
    : makePath;
  const [exact] = await database
    .select()
    .from(vehicleModelRedirect)
    .where(eq(vehicleModelRedirect.fromPath, normalizedPath))
    .limit(1);
  if (exact) return exact;
  if (!model) return null;
  const key = VehicleName.modelKey(normalizedMake, model.replace(/-/g, " "));
  const candidates = await database
    .select()
    .from(vehicleModelRedirect)
    .where(like(vehicleModelRedirect.fromPath, `${makePath}/%`));
  const matches = candidates.filter(
    (row) =>
      VehicleName.modelKey(
        normalizedMake,
        (row.fromPath.split("/")[3] ?? "").replace(/-/g, " "),
      ) === key,
  );
  if (!matches.length) return null;
  const destinations = new Set(matches.map((row) => row.toPath));
  return {
    fromPath: normalizedPath,
    toPath: destinations.size === 1 ? (matches[0]?.toPath ?? "") : makePath,
  };
}
