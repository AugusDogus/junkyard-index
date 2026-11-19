import { z } from "zod";
import { MakeInventory, type MakeRollupRow } from "../src/lib/make-inventory";
import { ModelRedirect } from "../src/lib/model-redirect";
import { ConsumerModel } from "../src/lib/consumer-model";
import { VinDecode } from "../src/server/ingestion/vin-decode";
import { VehicleName } from "../src/lib/vehicle-name";

export const storedModelSnapshotSchema = z.object({
  key: z.string(),
  data: z.string(),
});
export const modelFacetSchema = z.object({
  make: z.string(),
  model: z.string(),
  count: z.number(),
});
const countsSchema = z.array(z.object({ make: z.string(), count: z.number() }));
const tuplesSchema = z.array(
  z.tuple([
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.number(),
    z.number(),
    z.number(),
  ]),
);

/** Overlay accepted sample identities on the full live catalog, without writes. */
export function auditVinModelUrls(
  stored: z.infer<typeof storedModelSnapshotSchema>[],
  facets: z.infer<typeof modelFacetSchema>[],
  sample: {
    vin: string;
    year: number;
    make: string;
    model: string;
    count: number;
  }[],
  decoded: ReadonlyMap<string, VinDecode>,
) {
  const baseline = new Set<string>();
  const indexed = new Set<string>();
  for (const entry of stored.filter((row) =>
    row.key.endsWith(":make-counts"),
  )) {
    const version = entry.key.slice(0, -":make-counts".length);
    for (const make of MakeInventory.makes(
      countsSchema.parse(JSON.parse(entry.data)),
    )) {
      const data = stored.find(
        (row) => row.key === `${version}:make-models:${make.key}`,
      );
      if (!data) continue;
      const rows = tuplesSchema
        .parse(JSON.parse(data.data))
        .map(([source, code, make, model, count, minYear, maxYear]) => ({
          source,
          code,
          make,
          model,
          count,
          minYear,
          maxYear,
        }));
      for (const model of MakeInventory.models(make, rows)) {
        baseline.add(model.href);
        if (MakeInventory.indexable(model)) indexed.add(model.href);
      }
    }
  }
  const after = new Map(
    facets.map((row) => [JSON.stringify([row.make, row.model]), row.count]),
  );
  const aliases = new Map<string, string>();
  for (const row of sample) {
    const id = VinDecode.identity(row.vin, row.year);
    const identity = id ? decoded.get(id.key) : undefined;
    if (!identity) continue;
    const make = identity.make;
    const model = ConsumerModel.resolve({
      ...identity,
      sourceModel: row.model,
    });
    const oldKey = JSON.stringify([row.make, row.model]);
    const newKey = JSON.stringify([make, model]);
    after.set(oldKey, (after.get(oldKey) ?? 0) - row.count);
    after.set(newKey, (after.get(newKey) ?? 0) + row.count);
    const from = ModelRedirect.path(row.make, row.model);
    const to = ModelRedirect.path(make, model);
    if (from !== to)
      aliases.set(from, ModelRedirect.merge(from, aliases.get(from), to));
  }
  const rollups: MakeRollupRow[] = [...after]
    .filter(([, count]) => count > 0)
    .map(([pair, count]) => {
      const [make, model] = z
        .tuple([z.string(), z.string()])
        .parse(JSON.parse(pair));
      return {
        make,
        model,
        count,
        source: "sample",
        code: "sample",
        minYear: 1981,
        maxYear: 2100,
      };
    });
  const pages = new Map(
    MakeInventory.makes(rollups).map((make) => [
      make.slug,
      {
        make,
        models: MakeInventory.models(
          make,
          rollups.filter((row) => VehicleName.makeKey(row.make) === make.key),
        ),
      },
    ]),
  );
  const liveModels = new Set(
    [...pages.values()].flatMap((page) =>
      page.models.map((model) => model.href),
    ),
  );
  const liveDestinations = new Set([
    "/cars",
    ...liveModels,
    ...[...pages.values()].map((page) => page.make.href),
  ]);
  const redirects = [...baseline]
    .filter((path) => !liveModels.has(path))
    .map((from) => {
      const targetPath = aliases.get(from) || ModelRedirect.parent(from);
      const target = pages.get(targetPath.split("/")[2] ?? "") ?? null;
      const to = ModelRedirect.destination(targetPath, target);
      return {
        from,
        to,
        indexed: indexed.has(from),
        kind: liveModels.has(to) ? "model" : "parent",
      };
    });
  return {
    retainedModelUrls: baseline.size,
    indexedModelUrls: indexed.size,
    unchangedModelUrls: baseline.size - redirects.length,
    redirectCount: redirects.length,
    indexedRedirects: redirects.filter((row) => row.indexed).length,
    modelRedirects: redirects.filter((row) => row.kind === "model").length,
    parentRedirects: redirects.filter((row) => row.kind === "parent").length,
    unresolved: redirects.filter((row) => !liveDestinations.has(row.to)).length,
    redirects,
  };
}
