import type { VinCachePassState, VinCacheBatch } from "./vin-cache-pass";
import { asc, gt, inArray, sql } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { vehicle, vinDecodeCache } from "~/schema";
import { VinDecode, type VinIdentity } from "./vin-decode";
import { vpicClient, type VpicClient } from "./vpic-client";

const RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
/** vPIC patterns one step may request. */
const DECODE_BATCH_SIZE = 100;
/**
 * Vehicles one step reads. The pass runs in the same workflow run as the
 * migration, so it must cover the inventory in a few hundred steps to stay
 * within the run's event limit.
 */
const SCAN_BATCH_SIZE = 1000;

/** Patterns of `rows` with no cached identity whose retry delay has passed, in row order. */
async function pendingRequests(
  database: LibSQLDatabase,
  rows: readonly { vin: string; year: number }[],
  now: Date,
): Promise<Map<string, VinIdentity>> {
  const requests = new Map(
    rows.flatMap((row) => {
      const id = VinDecode.identity(row.vin, row.year);
      return id ? [[id.key, id] as const] : [];
    }),
  );
  if (requests.size === 0) return requests;
  const cached = await database
    .select()
    .from(vinDecodeCache)
    .where(inArray(vinDecodeCache.pattern, [...requests.keys()]));
  for (const entry of cached) {
    if (entry.data || (entry.retryAfter && entry.retryAfter > now))
      requests.delete(entry.pattern);
  }
  return requests;
}

async function decodeAndStore(
  database: LibSQLDatabase,
  pending: readonly VinIdentity[],
  client: VpicClient,
  now: Date,
) {
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

/** Only the pre-publication decode phase may call the network. */
export async function warmVinDecodeCache(
  database: LibSQLDatabase,
  rows: readonly { vin: string; year: number }[],
  client: VpicClient = vpicClient,
) {
  const now = new Date();
  const pending = await pendingRequests(database, rows, now);
  return decodeAndStore(
    database,
    [...pending.values()].slice(0, DECODE_BATCH_SIZE),
    client,
    now,
  );
}

/**
 * Reads up to a thousand vehicles after the cursor and decodes their
 * uncached patterns, at most 100 per step. When more are pending, the step
 * stops at the last vehicle whose pattern it decoded, so no vehicle is
 * skipped.
 */
export async function warmVinCacheBatch(
  database: LibSQLDatabase,
  state: VinCachePassState,
  client: VpicClient = vpicClient,
): Promise<VinCacheBatch> {
  const scanned = await database
    .select({ vin: vehicle.vin, year: vehicle.year })
    .from(vehicle)
    .where(state.cursor === null ? undefined : gt(vehicle.vin, state.cursor))
    .orderBy(asc(vehicle.vin))
    .limit(SCAN_BATCH_SIZE);
  const now = new Date();
  const pending = await pendingRequests(database, scanned, now);
  const requests = new Map<string, VinIdentity>();
  let covered = scanned.length;
  for (const [index, row] of scanned.entries()) {
    const key = VinDecode.identity(row.vin, row.year)?.key;
    const request = key === undefined ? undefined : pending.get(key);
    if (!request || requests.has(request.key)) continue;
    if (requests.size === DECODE_BATCH_SIZE) {
      covered = index;
      break;
    }
    requests.set(request.key, request);
  }
  const result = await decodeAndStore(
    database,
    [...requests.values()],
    client,
    now,
  );
  const exhausted =
    covered === scanned.length && scanned.length < SCAN_BATCH_SIZE;
  return {
    status:
      result.status === "unavailable"
        ? "unavailable"
        : exhausted
          ? "complete"
          : "pending",
    state: {
      cursor: scanned[covered - 1]?.vin ?? state.cursor,
      accepted: state.accepted + result.accepted,
    },
  };
}
