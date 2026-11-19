import "server-only";
import { eq } from "drizzle-orm";
import { db } from "~/lib/db";
import { vehicleModelRedirect } from "~/schema";
import { getMakePageData } from "./vehicle-models";
import { VehicleName } from "~/lib/vehicle-name";

/** Called only when the requested make or model has no live page. */
export async function getVehicleModelRedirect(
  path: string,
): Promise<string | null> {
  const [redirect] = await db
    .select()
    .from(vehicleModelRedirect)
    .where(eq(vehicleModelRedirect.fromPath, path))
    .limit(1);
  if (!redirect?.toPath) return null;
  const [, prefix, makeSlug, modelSlug] = redirect.toPath.split("/");
  if (prefix !== "cars" || !makeSlug) return null;
  const target = await getMakePageData(makeSlug);
  if (!target) return null;
  // Redirect only to a live page, preventing chains/cycles after inventory retires.
  if (!modelSlug) return target.make.href;
  return (
    target.models.find((model) => VehicleName.sameSlug(model.slug, modelSlug))
      ?.href ?? null
  );
}
