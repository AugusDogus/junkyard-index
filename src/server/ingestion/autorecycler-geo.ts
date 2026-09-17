import { Effect } from "effect";
import { eq, sql } from "drizzle-orm";
import { autorecyclerOrgGeo } from "~/schema";
import { AutorecyclerProviderError, PersistenceError } from "./errors";
import { Database } from "./context";
import {
  buildMgetBody,
  buildWebsiteLookupMsearchBody,
  fetchAutorecyclerDetailsInitData,
  postAutorecyclerElasticsearchMget,
  postAutorecyclerElasticsearchMsearch,
  type AutorecyclerMgetDoc,
} from "./autorecycler-client";
import { normalizeRegion } from "./normalization";
import type { AutorecyclerOrgGeo } from "./autorecycler-transform";

export type { AutorecyclerOrgGeo };
type DbClient = typeof import("~/lib/db").db;
const GEO_RESOLVE_CONCURRENCY = 3;
// Version 0 may contain inventory GPS or another branch's organization address.
const GEO_RESOLUTION_VERSION = 1;

function hasKnownCity(city: string): boolean {
  return city.trim().length > 0 && city.trim().toLowerCase() !== "unknown";
}

export function resolveAutorecyclerSeeds<E, R>(
  seeds: ReadonlyMap<string, string>,
  resolveOne: (params: {
    orgLookup: string;
    inventoryIdSeed: string;
  }) => Effect.Effect<unknown, E, R>,
): Effect.Effect<void, E, R> {
  return Effect.forEach(
    seeds,
    ([orgLookup, inventoryIdSeed]) =>
      resolveOne({ orgLookup, inventoryIdSeed }),
    { concurrency: GEO_RESOLVE_CONCURRENCY, discard: true },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function organizationRecordId(reference: string): string | null {
  const value = reference.trim();
  if (/^\d+x\d+$/.test(value)) return value;
  return /^\d+__LOOKUP__(\d+x\d+)$/.exec(value)?.[1] ?? null;
}

function ownsOrganization(value: unknown, expectedOrg: string): boolean {
  if (typeof value !== "string") return false;
  const actual = value.trim();
  const recordId = organizationRecordId(expectedOrg);
  return recordId !== null && (actual === expectedOrg || actual === recordId);
}

export function parseOrgGeoFromWebsiteRecord(
  src: Record<string, unknown>,
  expectedOrg: string,
): AutorecyclerOrgGeo | null {
  const want = expectedOrg.trim();
  if (want.length === 0) return null;

  if (!ownsOrganization(src.organization_custom_organization, want))
    return null;
  if (src._type !== undefined && src._type !== "custom.website") return null;

  const geoUnknown = src.address_geographic_address;
  if (!isRecord(geoUnknown)) return null;
  const lat = geoUnknown.lat;
  const lng = geoUnknown.lng;
  if (
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    typeof lng !== "number" ||
    !Number.isFinite(lng) ||
    Math.abs(lng) > 180
  )
    return null;

  const components = isRecord(geoUnknown.components)
    ? geoUnknown.components
    : {};
  const state = typeof components.state === "string" ? components.state : "";
  const stateAbbr =
    typeof components["state code"] === "string"
      ? components["state code"]
      : "";
  const city = typeof components.city === "string" ? components.city : "";
  const address =
    typeof geoUnknown.address === "string" ? geoUnknown.address : undefined;
  const locationName =
    typeof src.name_text === "string" && src.name_text.trim().length > 0
      ? src.name_text.trim()
      : "AutoRecycler";
  const locationCity = city && city.trim().length > 0 ? city.trim() : "Unknown";
  const region = normalizeRegion(state, stateAbbr);

  return {
    orgLookup: want,
    lat,
    lng,
    locationName,
    locationCity,
    state: region.state || "Unknown",
    stateAbbr: region.stateAbbr,
    address,
  };
}

export function parseOrgGeoFromOrganizationDoc(
  doc: AutorecyclerMgetDoc,
  expectedOrg: string,
): AutorecyclerOrgGeo | null {
  const want = expectedOrg.trim();
  if (want.length === 0) return null;
  const src = doc._source;
  if (!isRecord(src) || doc.found === false) return null;
  if ((doc._type ?? src._type) !== "custom.organization") return null;
  if (src._type !== undefined && src._type !== "custom.organization")
    return null;
  if (!ownsOrganization(doc._id ?? src._id, want)) return null;
  if (src._id !== undefined && !ownsOrganization(src._id, want)) return null;

  const geoUnknown = src.address1_geographic_address;
  if (!isRecord(geoUnknown)) return null;
  const lat = geoUnknown.lat;
  const lng = geoUnknown.lng;
  if (
    typeof lat !== "number" ||
    !Number.isFinite(lat) ||
    Math.abs(lat) > 90 ||
    typeof lng !== "number" ||
    !Number.isFinite(lng) ||
    Math.abs(lng) > 180
  )
    return null;

  const components = isRecord(geoUnknown.components)
    ? geoUnknown.components
    : {};
  const state = typeof components.state === "string" ? components.state : "";
  const stateAbbr =
    typeof components["state code"] === "string"
      ? components["state code"]
      : "";
  const city =
    typeof components.city === "string" && hasKnownCity(components.city)
      ? components.city
      : typeof src.address_city_text === "string"
        ? src.address_city_text
        : "";
  const address =
    typeof geoUnknown.address === "string" ? geoUnknown.address : undefined;
  const locationName =
    typeof src.name_text === "string" && src.name_text.trim().length > 0
      ? src.name_text.trim()
      : "AutoRecycler";
  const locationCity = city && city.trim().length > 0 ? city.trim() : "Unknown";
  const region = normalizeRegion(state, stateAbbr);

  return {
    orgLookup: want,
    lat,
    lng,
    locationName,
    locationCity,
    state: region.state || "Unknown",
    stateAbbr: region.stateAbbr,
    address,
  };
}

/** Inventory GPS can be inherited from a parent yard. Only organization rows prove location. */
export function parseOrgGeoFromDetailsInitData(
  rows: Array<{ type?: string; data?: Record<string, unknown> }>,
  expectedOrg: string,
): AutorecyclerOrgGeo | null {
  const want = expectedOrg.trim();
  if (want.length === 0) return null;

  for (const row of rows) {
    const d = row.data;
    if (!isRecord(d)) continue;
    const geo = parseOrgGeoFromOrganizationDoc(
      { _type: row.type, _source: d },
      want,
    );
    if (geo && hasKnownCity(geo.locationCity)) return geo;
  }
  return null;
}

function upsertAndCacheOrgGeo(params: {
  dbClient: DbClient;
  memory: Map<string, AutorecyclerOrgGeo>;
  geo: AutorecyclerOrgGeo;
}): Effect.Effect<AutorecyclerOrgGeo, PersistenceError> {
  const { dbClient, memory, geo } = params;
  const now = new Date();

  return Effect.tryPromise({
    try: () =>
      dbClient
        .insert(autorecyclerOrgGeo)
        .values({
          orgLookup: geo.orgLookup,
          lat: geo.lat,
          lng: geo.lng,
          locationName: geo.locationName,
          locationCity: geo.locationCity,
          state: geo.state,
          stateAbbr: geo.stateAbbr,
          address: geo.address ?? null,
          resolutionVersion: GEO_RESOLUTION_VERSION,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: autorecyclerOrgGeo.orgLookup,
          set: {
            lat: sql`excluded.lat`,
            lng: sql`excluded.lng`,
            locationName: sql`excluded.location_name`,
            locationCity: sql`excluded.location_city`,
            state: sql`excluded.state`,
            stateAbbr: sql`excluded.state_abbr`,
            address: sql`excluded.address`,
            resolutionVersion: sql`excluded.resolution_version`,
            updatedAt: sql`excluded.updated_at`,
          },
        }),
    catch: (cause) =>
      new PersistenceError({ operation: "autorecyclerOrgGeo.upsert", cause }),
  }).pipe(
    Effect.tap(() => Effect.sync(() => memory.set(geo.orgLookup, geo))),
    Effect.as(geo),
  );
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
    AutorecyclerOrgGeo,
    PersistenceError | AutorecyclerProviderError,
    Database
  > =>
    Effect.gen(function* () {
      const orgLookup = params.orgLookup.trim();
      const { inventoryIdSeed } = params;
      const recordId = organizationRecordId(orgLookup);
      if (!recordId) {
        return yield* new AutorecyclerProviderError({
          from: -1,
          cause: new Error(
            `Invalid AutoRecycler organization reference ${orgLookup}: expected <digits>__LOOKUP__<digits>x<digits> or a bare record ID. Check the inventory organization reference before retrying.`,
          ),
        });
      }
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
          new PersistenceError({
            operation: "autorecyclerOrgGeo.select",
            cause,
          }),
      }).pipe(
        Effect.tapError((e) =>
          Effect.logError(
            `[AutoRecycler geo] DB select failed for org=${orgLookup}: ${e.message}`,
          ),
        ),
      );

      if (
        existing &&
        existing.resolutionVersion === GEO_RESOLUTION_VERSION &&
        hasKnownCity(existing.locationCity)
      ) {
        geoHitDb++;
        const mapped: AutorecyclerOrgGeo = {
          orgLookup: existing.orgLookup,
          lat: existing.lat,
          lng: existing.lng,
          locationName: existing.locationName,
          locationCity: existing.locationCity,
          state: existing.state,
          stateAbbr: existing.stateAbbr,
          address: existing.address ?? undefined,
        };
        memory.set(orgLookup, mapped);
        return mapped;
      }

      geoFetches++;

      const mget = yield* Effect.tryPromise({
        try: () => postAutorecyclerElasticsearchMget(buildMgetBody([recordId])),
        catch: (cause) =>
          new AutorecyclerProviderError({
            from: -1,
            cause: new Error(
              `organization mget orgLookup=${orgLookup} recordId=${recordId}: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            ),
          }),
      }).pipe(
        Effect.tapError((e) =>
          Effect.logError(`[AutoRecycler geo] ${e.message}`),
        ),
      );

      const parsedFromOrganization =
        mget.docs
          ?.map((doc) => parseOrgGeoFromOrganizationDoc(doc, orgLookup))
          .find(
            (value) => value !== null && hasKnownCity(value.locationCity),
          ) ?? null;
      if (parsedFromOrganization) {
        return yield* upsertAndCacheOrgGeo({
          dbClient,
          memory,
          geo: parsedFromOrganization,
        }).pipe(
          Effect.tapError((e) =>
            Effect.logError(
              `[AutoRecycler geo] DB upsert failed for org=${orgLookup}: ${e.message}`,
            ),
          ),
        );
      }

      const website = yield* Effect.tryPromise({
        try: async () => {
          const res = await postAutorecyclerElasticsearchMsearch(
            buildWebsiteLookupMsearchBody(orgLookup),
          );
          const src = res.responses?.[0]?.hits?.hits?.[0]?._source;
          return isRecord(src) ? src : null;
        },
        catch: (cause) =>
          new AutorecyclerProviderError({
            from: -1,
            cause: new Error(
              `website msearch orgLookup=${orgLookup}: ${cause instanceof Error ? cause.message : String(cause)}`,
              {
                cause,
              },
            ),
          }),
      }).pipe(
        Effect.tapError((e) =>
          Effect.logError(`[AutoRecycler geo] ${e.message}`),
        ),
      );

      const parsedFromWebsite = website
        ? parseOrgGeoFromWebsiteRecord(website, orgLookup)
        : null;
      if (parsedFromWebsite && hasKnownCity(parsedFromWebsite.locationCity)) {
        return yield* upsertAndCacheOrgGeo({
          dbClient,
          memory,
          geo: parsedFromWebsite,
        }).pipe(
          Effect.tapError((e) =>
            Effect.logError(
              `[AutoRecycler geo] DB upsert failed for org=${orgLookup}: ${e.message}`,
            ),
          ),
        );
      }

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
        return yield* new AutorecyclerProviderError({
          from: -1,
          cause: new Error(
            `Could not resolve an owned yard address and city for AutoRecycler organization ${orgLookup}. The source refresh was stopped without replacing cached data; inspect the organization's address or its own website record before retrying. Inventory GPS and related organizations cannot establish this yard's location.`,
          ),
        });
      }
      return yield* upsertAndCacheOrgGeo({
        dbClient,
        memory,
        geo: parsed,
      }).pipe(
        Effect.tapError((e) =>
          Effect.logError(
            `[AutoRecycler geo] DB upsert failed for org=${orgLookup}: ${e.message}`,
          ),
        ),
      );
    });

  /** Resolve many independent orgs with bounded provider concurrency. */
  const resolveBatchEffect = (
    seeds: ReadonlyMap<string, string>,
  ): Effect.Effect<
    void,
    PersistenceError | AutorecyclerProviderError,
    Database
  > => resolveAutorecyclerSeeds(seeds, resolveOneEffect);

  return {
    getCached: (orgLookup: string) => memory.get(orgLookup),
    resolveOneEffect,
    resolveBatchEffect,
    getStats,
  };
}
