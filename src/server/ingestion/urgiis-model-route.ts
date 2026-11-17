import type { UrgiisTenant } from "./urgiis-tenant";

/** The qualified IIS backend does not URL-decode model text. Its menu's -and
 * token is broken, raw & enumerates donors, and donor links use and__. Keep
 * checkpoint/menu paths literal and translate only these verified spellings. */
export function urgiisModelRoute(path: string, tenant: UrgiisTenant) {
  if (tenant.modelEncoding !== "literal-ampersand")
    return { requestPath: path, donorPath: path };
  const parts = path.split("/");
  const model = parts[3];
  if (!model) return { requestPath: path, donorPath: path };
  const withModel = (value: string) =>
    [...parts.slice(0, 3), value, ...parts.slice(4)].join("/");
  return {
    requestPath: withModel(model.replaceAll("_-and_", "_&_")),
    donorPath: withModel(model.replaceAll("_-and_", "_and__")),
  };
}
