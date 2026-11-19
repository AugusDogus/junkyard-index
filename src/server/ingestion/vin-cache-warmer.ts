import type { VinCachePassState, VinCacheBatch } from "./vin-cache-pass";
import { asc, gt, inArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle, vinDecodeCache } from "~/schema";
import { VinDecode } from "./vin-decode";
import { vpicClient, type VpicClient } from "./vpic-client";

const RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100;

/** Only the pre-publication decode phase may call the network. */
export async function warmVinDecodeCache(
  database: LibSQLDatabase,
  rows: readonly { vin: string; year: number }[],
  client: VpicClient = vpicClient,
) {
  const requests = new Map(
    rows.flatMap((row) => {
      const id = VinDecode.identity(row.vin, row.year);
      return id ? [[id.key, id] as const] : [];
    }),
  );
  if (requests.size === 0) return { status: "complete" as const, accepted: 0 };
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
    .slice(0, BATCH_SIZE);
  if (!pending.length) return { status: "complete" as const, accepted: 0 };
  const result = await client.decode(pending);
  const entries = pending.map((request) => ({
    pattern: request.key,
    data: result.decodes.get(request.key) ?? null,
    retryAfter: result.decodes.has(request.key)
      ? null
      : new Date(now.getTime() + RETRY_DELAY_MS),
    updatedAt: now,
  }));
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
  return { status: result.status, accepted: result.decodes.size };
}

export async function warmVinCacheBatch(
  database: LibSQLDatabase,
  state: VinCachePassState,
  client: VpicClient = vpicClient,
): Promise<VinCacheBatch> {
  const rows = await database
    .select({ vin: vehicle.vin, year: vehicle.year })
    .from(vehicle)
    .where(state.cursor === null ? undefined : gt(vehicle.vin, state.cursor))
    .orderBy(asc(vehicle.vin))
    .limit(BATCH_SIZE);
  const result = await warmVinDecodeCache(database, rows, client);
  return {
    status:
      result.status === "unavailable"
        ? "unavailable"
        : rows.length < BATCH_SIZE
          ? "complete"
          : "pending",
    state: {
      cursor: rows.at(-1)?.vin ?? state.cursor,
      accepted: state.accepted + result.accepted,
    },
  };
}
