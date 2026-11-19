import { inArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vinDecodeCache, vehicleModelRedirect } from "~/schema";
import { VehicleName } from "~/lib/vehicle-name";
import { normalizeCanonicalVehicle } from "./normalization";
import type { CanonicalVehicle } from "./types";
import { VinDecode } from "./vin-decode";
import { vpicClient, type VpicClient } from "./vpic-client";

const RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
// At most two 50-VIN requests per reconciliation/migration batch. New misses
// beyond this budget keep source names until the next daily ingestion.
const MAX_NEW_PATTERNS = 100;

export async function canonicalizeVinVehicles<T extends CanonicalVehicle>(
  database: LibSQLDatabase,
  rows: T[],
  client: VpicClient = vpicClient,
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
  const now = new Date();
  const pending = [...requests.values()]
    .filter((request) => {
      const entry = byPattern.get(request.key);
      return (
        !entry ||
        (!entry.data && (!entry.retryAfter || entry.retryAfter <= now))
      );
    })
    .slice(0, MAX_NEW_PATTERNS);
  const decoded = pending.length
    ? await client.decode(pending)
    : new Map<string, VinDecode>();
  const entries = pending.map((request) => {
    const data = decoded.get(request.key) ?? null;
    return {
      pattern: request.key,
      data,
      retryAfter: data ? null : new Date(now.getTime() + RETRY_DELAY_MS),
      updatedAt: now,
    };
  });
  if (entries.length)
    await database
      .insert(vinDecodeCache)
      .values(entries)
      .onConflictDoUpdate({
        target: vinDecodeCache.pattern,
        set: {
          data: sql`excluded.data`,
          retryAfter: sql`excluded.retry_after`,
          updatedAt: now,
        },
      });
  for (const entry of entries) byPattern.set(entry.pattern, entry);
  if (decoded.size < pending.length)
    console.warn(
      `[VIN decode] ${pending.length - decoded.size} of ${pending.length} patterns have no trusted identity. Source names are preserved; retry after 24 hours.`,
    );
  return rows.map((row) => {
    const request = VinDecode.identity(row.vin, row.year);
    const decode = request ? byPattern.get(request.key)?.data : null;
    const normalized = sourceFallback(row);
    if (!decode || decode.year !== row.year) return normalized;
    return {
      ...row,
      ...normalized,
      make: decode.make,
      model: decode.model,
      sourceMake: row.sourceMake ?? row.make,
      sourceModel: row.sourceModel ?? row.model,
      trim: row.trim?.trim() || decode.trim,
    };
  });
}

/** Only unambiguous old URLs redirect. Conflicting targets remain unresolved. */
export async function rememberModelRedirects(
  database: LibSQLDatabase,
  rows: CanonicalVehicle[],
) {
  const redirects = new Map<string, string>();
  for (const row of rows) {
    if (!row.sourceMake || !row.sourceModel) continue;
    const from = modelPath(row.sourceMake, row.sourceModel);
    const to = modelPath(row.make, row.model);
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
      redirects.set(
        fromPath,
        previous === undefined || previous === toPath ? toPath : "",
      );
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
          // An ambiguous label stays unresolved, including across later batches.
          toPath: sql`case when ${vehicleModelRedirect.toPath} = excluded.to_path then excluded.to_path else '' end`,
        },
      });
}

function modelPath(make: string, model: string): string {
  const normalizedMake = VehicleName.makeName(make);
  const name = VehicleName.modelName(normalizedMake, model);
  return `/cars/${VehicleName.slug(normalizedMake)}/${VehicleName.slug(name)}`;
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
