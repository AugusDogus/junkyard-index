import { ModelRedirect } from "~/lib/model-redirect";
import { ConsumerIdentity } from "~/lib/consumer-identity";
import { inArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vinDecodeCache, vehicleModelRedirect } from "~/schema";
import { VehicleName } from "~/lib/vehicle-name";
import { normalizeCanonicalVehicle } from "./normalization";
import type { CanonicalVehicle } from "./types";
import { VinDecode } from "./vin-decode";

export async function canonicalizeVinVehicles<T extends CanonicalVehicle>(
  database: LibSQLDatabase,
  rows: T[],
): Promise<T[]> {
  const requests = new Map(
    rows.flatMap((row) => {
      const id = VinDecode.identity(row.vin, row.year);
      return id ? [[id.key, id] as const] : [];
    }),
  );
  if (requests.size === 0) return rows.map(sourceFallback);
  const cached = await database
    .select()
    .from(vinDecodeCache)
    .where(inArray(vinDecodeCache.pattern, [...requests.keys()]));
  const byPattern = new Map(cached.map((row) => [row.pattern, row]));
  return rows.map((row) => {
    const request = VinDecode.identity(row.vin, row.year);
    const decode = request ? byPattern.get(request.key)?.data : null;
    const normalized = sourceFallback(row);
    if (!decode || decode.year !== row.year) return normalized;
    const identity = ConsumerIdentity.resolve({
      ...decode,
      sourceMake: row.sourceMake ?? row.make,
      sourceModel: row.sourceModel ?? row.model,
    });
    return {
      ...row,
      ...normalized,
      ...identity,
      sourceMake: row.sourceMake ?? row.make,
      sourceModel: row.sourceModel ?? row.model,
      trim: row.trim?.trim() || decode.trim,
    };
  });
}

/** Unique aliases redirect to a model; ambiguous labels retain a live make destination. */
export async function rememberModelRedirects(
  database: LibSQLDatabase,
  rows: CanonicalVehicle[],
) {
  const redirects = new Map<string, string>();
  for (const row of rows) {
    if (!row.sourceMake || !row.sourceModel) continue;
    const from = ModelRedirect.path(row.sourceMake, row.sourceModel);
    const to = ModelRedirect.path(row.make, row.model);
    if (from === to) continue;
    for (const [fromPath, toPath] of [
      [from, to],
      [
        `/cars/${VehicleName.slug(VehicleName.makeName(row.sourceMake))}`,
        `/cars/${VehicleName.slug(VehicleName.makeName(row.make))}`,
      ],
    ]) {
      if (!fromPath || !toPath || fromPath === toPath) continue;
      const previous = redirects.get(fromPath);
      redirects.set(fromPath, ModelRedirect.merge(fromPath, previous, toPath));
    }
  }
  const entries = [...redirects].map(([fromPath, toPath]) => ({
    fromPath,
    toPath,
  }));
  if (entries.length)
    await database
      .insert(vehicleModelRedirect)
      .values(entries)
      .onConflictDoUpdate({
        target: vehicleModelRedirect.fromPath,
        set: {
          // An ambiguous label keeps its parent destination across later batches.
          toPath: sql`case
            when ${vehicleModelRedirect.toPath} = '' or ${vehicleModelRedirect.toPath} = excluded.to_path then excluded.to_path
            when instr(substr(${vehicleModelRedirect.fromPath}, 7), '/') > 0
              then substr(${vehicleModelRedirect.fromPath}, 1, 5 + instr(substr(${vehicleModelRedirect.fromPath}, 7), '/'))
            else '/cars' end`,
        },
      });
}

function sourceFallback<T extends CanonicalVehicle>(row: T): T {
  const sourceMake = row.sourceMake ?? row.make;
  const sourceModel = row.sourceModel ?? row.model;
  return {
    ...row,
    ...normalizeCanonicalVehicle({
      ...row,
      make: sourceMake,
      model: sourceModel,
    }),
    sourceMake,
    sourceModel,
  };
}
