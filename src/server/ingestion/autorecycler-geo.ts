import { Effect } from "effect";
import { eq, sql } from "drizzle-orm";
import { autorecyclerOrgGeo } from "~/schema";
import { AutorecyclerProviderError, PersistenceError } from "./errors";
import { Database } from "./runtime";
import { fetchAutorecyclerDetailsInitData } from "./autorecycler-client";
import type { AutorecyclerOrgGeo } from "./autorecycler-transform";

export type { AutorecyclerOrgGeo };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extract yard geolocation from `init/data` rows for a vehicle details page. */
export function parseOrgGeoFromDetailsInitData(
  rows: Array<{ type?: string; data?: Record<string, unknown> }>,
  expectedOrg: string,
): AutorecyclerOrgGeo | null {
  const want = expectedOrg.trim();
  if (want.length === 0) return null;

  for (const row of rows) {
    const d = row.data;
    if (!isRecord(d)) continue;
    const t = row.type ?? (typeof d._type === "string" ? d._type : undefined);
    if (t !== "custom.inventory") continue;

    const orgRaw =
      typeof d.organization_custom_organization === "string"
        ? d.organization_custom_organization.trim()
        : null;
    if (!orgRaw || orgRaw !== want) continue;

    const geoUnknown = d.gps_location_geographic_address;
    if (!isRecord(geoUnknown)) continue;
    const lat = geoUnknown.lat;
    const lng = geoUnknown.lng;
    if (typeof lat !== "number" || typeof lng !== "number") continue;

    const components = isRecord(geoUnknown.components) ? geoUnknown.components : {};
    const state = typeof components.state === "string" ? components.state : "";
    const stateAbbr =
      typeof components["state code"] === "string" ? components["state code"] : "";
    const city = typeof components.city === "string" ? components.city : "";
    const address =
      typeof geoUnknown.address === "string" ? geoUnknown.address : undefined;

    const locationName =
      city && stateAbbr
        ? `${city}, ${stateAbbr}`
        : address && address.length > 0
          ? address.split(",")[0]!.trim()
          : "AutoRecycler";

    const stateOut = state || stateAbbr || "Unknown";

    return {
      orgLookup: want,
      lat,
      lng,
      locationName,
      state: stateOut,
      stateAbbr,
      address,
    };
  }
  return null;
}

export function createAutorecyclerOrgGeoResolver() {
  const memory = new Map<string, AutorecyclerOrgGeo>();
  let geoLookupCount = 0;
  let geoHitMemory = 0;
  let geoHitDb = 0;
  let geoFetches = 0;
  let geoMissAfterFetch = 0;

  const getStats = () => ({
    geoLookupCount,
    geoHitMemory,
    geoHitDb,
    geoFetches,
    geoMissAfterFetch,
  });

  const resolveOneEffect = (params: {
    orgLookup: string;
    inventoryIdSeed: string;
  }): Effect.Effect<
    AutorecyclerOrgGeo | null,
    PersistenceError | AutorecyclerProviderError,
    Database
  > =>
    Effect.gen(function* () {
      const { orgLookup, inventoryIdSeed } = params;
      geoLookupCount++;

      const cachedMem = memory.get(orgLookup);
      if (cachedMem) {
        geoHitMemory++;
        return cachedMem;
      }

      const dbClient = yield* Database;
      const [existing] = yield* Effect.tryPromise({
        try: () =>
          dbClient
            .select()
            .from(autorecyclerOrgGeo)
            .where(eq(autorecyclerOrgGeo.orgLookup, orgLookup))
            .limit(1),
        catch: (cause) =>
          new PersistenceError({ operation: "autorecyclerOrgGeo.select", cause }),
      }).pipe(
        Effect.tapError((e) =>
          Effect.logError(
            `[AutoRecycler geo] DB select failed for org=${orgLookup}: ${e.message}`,
          ),
        ),
      );

      if (existing) {
        geoHitDb++;
        const mapped: AutorecyclerOrgGeo = {
          orgLookup: existing.orgLookup,
          lat: existing.lat,
          lng: existing.lng,
          locationName: existing.locationName,
          state: existing.state,
          stateAbbr: existing.stateAbbr,
          address: existing.address ?? undefined,
        };
        memory.set(orgLookup, mapped);
        return mapped;
      }

      geoFetches++;

      const rows = yield* Effect.tryPromise({
        try: () => fetchAutorecyclerDetailsInitData(inventoryIdSeed),
        catch: (cause) =>
          new AutorecyclerProviderError({
            from: -1,
            cause: new Error(
              `details init/data orgLookup=${orgLookup} inventoryId=${inventoryIdSeed}: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            ),
          }),
      }).pipe(
        Effect.tapError((e) =>
          Effect.logError(`[AutoRecycler geo] ${e.message}`),
        ),
      );

      const parsed = parseOrgGeoFromDetailsInitData(rows, orgLookup);
      if (!parsed) {
        geoMissAfterFetch++;
        return null;
      }

      const now = new Date();
      yield* Effect.tryPromise({
        try: () =>
          dbClient
            .insert(autorecyclerOrgGeo)
            .values({
              orgLookup: parsed.orgLookup,
              lat: parsed.lat,
              lng: parsed.lng,
              locationName: parsed.locationName,
              state: parsed.state,
              stateAbbr: parsed.stateAbbr,
              address: parsed.address ?? null,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: autorecyclerOrgGeo.orgLookup,
              set: {
                lat: sql`excluded.lat`,
                lng: sql`excluded.lng`,
                locationName: sql`excluded.location_name`,
                state: sql`excluded.state`,
                stateAbbr: sql`excluded.state_abbr`,
                address: sql`excluded.address`,
                updatedAt: sql`excluded.updated_at`,
              },
            }),
        catch: (cause) =>
          new PersistenceError({ operation: "autorecyclerOrgGeo.upsert", cause }),
      }).pipe(
        Effect.tapError((e) =>
          Effect.logError(
            `[AutoRecycler geo] DB upsert failed for org=${orgLookup}: ${e.message}`,
          ),
        ),
      );

      memory.set(orgLookup, parsed);
      return parsed;
    });

  /** Resolve many orgs; uses lazy sequential resolution to reduce rate-limit risk. */
  const resolveBatchEffect = (
    seeds: ReadonlyMap<string, string>,
  ): Effect.Effect<
    void,
    PersistenceError | AutorecyclerProviderError,
    Database
  > =>
    Effect.gen(function* () {
      for (const [org, inv] of seeds) {
        yield* resolveOneEffect({ orgLookup: org, inventoryIdSeed: inv }).pipe(
          Effect.asVoid,
        );
      }
    }).pipe(Effect.asVoid);

  return {
    getCached: (orgLookup: string) => memory.get(orgLookup),
    resolveOneEffect,
    resolveBatchEffect,
    getStats,
  };
}
