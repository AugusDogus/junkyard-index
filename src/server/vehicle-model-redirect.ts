import "server-only";
import { db } from "~/lib/db";
import { findModelRedirect } from "./model-url-history";
import { getMakePageData } from "./vehicle-models";
import { ModelRedirect } from "~/lib/model-redirect";

/** Called only when the requested make or model has no live page. */
export async function getVehicleModelRedirect(
  path: string,
): Promise<string | null> {
  const redirect = await findModelRedirect(db, path);
  if (!redirect) return null;
  const targetPath = redirect.toPath || ModelRedirect.parent(path);
  const makeSlug = targetPath.split("/")[2];
  const target = makeSlug ? await getMakePageData(makeSlug) : null;
  return ModelRedirect.destination(targetPath, target);
}
