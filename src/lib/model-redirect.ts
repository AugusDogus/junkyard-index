import { VehicleName } from "./vehicle-name";

export type ModelRedirect = { fromPath: string; toPath: string };

function parent(path: string): string {
  const parts = path.split("/");
  return parts.length > 3 ? parts.slice(0, 3).join("/") : "/cars";
}

function path(make: string, model: string): string {
  const normalized = VehicleName.makeName(make);
  return `/cars/${VehicleName.slug(normalized)}/${VehicleName.slug(VehicleName.modelName(normalized, model))}`;
}

/** Empty means a captured URL whose vehicle mappings have not been visited yet. */
function merge(
  from: string,
  previous: string | undefined,
  next: string,
): string {
  if (previous === undefined || previous === "") return next;
  return previous === next ? next : parent(from);
}

/** Known retired/ambiguous URLs always have a live parent destination. */
function destination(
  targetPath: string,
  target: {
    make: { href: string; name: string };
    models: readonly { href: string; key: string; slug: string }[];
  } | null,
): string {
  if (!target) return "/cars";
  const modelSlug = targetPath.split("/")[3];
  if (!modelSlug) return target.make.href;
  const modelKey = VehicleName.modelKey(
    target.make.name,
    modelSlug.replace(/-/g, " "),
  );
  return (
    target.models.find(
      (model) =>
        model.key === modelKey || VehicleName.sameSlug(model.slug, modelSlug),
    )?.href ?? target.make.href
  );
}

export const ModelRedirect = { parent, path, merge, destination } as const;
