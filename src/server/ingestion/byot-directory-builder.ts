import { z } from "zod";

const ControlSchema = z.array(
  z.object({ path: z.string(), data: z.unknown() }),
);
/** Derive the finite native search controls from saved year-specific menus.
 * Group equivalent modern make menus before adding older spellings. Keep the
 * Jeep search correction separate from directory grouping. */
export function buildByotDirectory(input: unknown) {
  const controls = ControlSchema.parse(input);
  const modern = new Map<string, Set<string>>();
  const older: { make: string; models: string[] }[] = [];
  for (const control of controls) {
    const url = new URL(control.path, "https://api.byotautoparts.com");
    if (url.pathname !== "/search/models") continue;
    const make = z.string().min(1).parse(url.searchParams.get("make"));
    const year = z.coerce
      .number()
      .int()
      .min(1900)
      .max(2100)
      .parse(url.searchParams.get("year"));
    const models = z.array(z.string().min(1)).parse(control.data);
    if (year < 1980) older.push({ make, models });
    else {
      const names = modern.get(make) ?? new Set<string>();
      for (const model of models) names.add(model);
      modern.set(make, names);
    }
  }
  if (modern.size < 50)
    throw new Error(
      "BYOT directory is incomplete: fewer than 50 native make menus; retain the qualified directory",
    );
  const groups = new Map<string, { make: string; models: string[] }>();
  for (const [make, names] of [...modern].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const models = [...names].sort();
    const key = JSON.stringify(models);
    if (!groups.has(key)) groups.set(key, { make, models });
  }
  const queries = new Map<string, { make: string; model: string }>();
  function add(make: string, model: string) {
    queries.set(JSON.stringify([make, model]), { make, model });
  }
  for (const group of groups.values())
    for (const model of group.models) add(group.make, model);
  for (const make of ["CHRYSLER", "AMC"])
    for (const model of modern.get(make) ?? []) add("JEEP", model);
  for (const group of older)
    for (const model of group.models) add(group.make, model);
  return [...queries.values()].sort(
    (a, b) => a.make.localeCompare(b.make) || a.model.localeCompare(b.model),
  );
}
