import { Effect } from "effect";
import { eq, sql } from "drizzle-orm";
import { autorecyclerOrgGeo } from "~/schema";
import { AutorecyclerProviderError, PersistenceError } from "./errors";
import { Database } from "./runtime";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractLocationNameFromSeoDescription(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = decodeHtmlEntities(value).trim();
  if (!text) return null;

  const patterns = [
    /look no further than\s+([^!.]+?)(?:!|,|\s+your\b)/i,
    /find the(?: used car)? parts you need at\s+([^!.]+?)(?:!|,| today\b|\.)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const name = match?.[1]?.trim();
    if (name) {
      return name;
    }
  }

  return null;
}

export function parseOrgGeoFromWebsiteRecord(
  src: Record<string, unknown>,
  expectedOrg: string,
): AutorecyclerOrgGeo | null {
  const want = expectedOrg.trim();
  if (want.length === 0) return null;

  const orgRaw =
    typeof src.organization_custom_organization === "string"
      ? src.organization_custom_organization.trim()
      : null;
  if (!orgRaw || orgRaw !== want) return null;

  const geoUnknown = src.address_geographic_address;
  if (!isRecord(geoUnknown)) return null;
  const lat = geoUnknown.lat;
  const lng = geoUnknown.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const components = isRecord(geoUnknown.components) ? geoUnknown.components : {};
  const state = typeof components.state === "string" ? components.state : "";
  const stateAbbr =
    typeof components["state code"] === "string" ? components["state code"] : "";
  const city = typeof components.city === "string" ? components.city : "";
  const address =
    typeof geoUnknown.address === "string" ? geoUnknown.address : undefined;
  const locationName =
    typeof src.name_text === "string" && src.name_text.trim().length > 0
      ? src.name_text.trim()
      : "AutoRecycler";
  const locationCity =
    city && city.trim().length > 0
      ? city.trim()
      : address && address.length > 0
        ? address.split(",")[0]!.trim()
        : "Unknown";
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
  if (!isRecord(src)) return null;
  const docId = typeof doc._id === "string" ? doc._id.trim() : "";
  const parentOrg =
    typeof src.parent_organization_custom_organization === "string"
      ? src.parent_organization_custom_organization.trim()
      : "";
  const partnerOrgs = Array.isArray(src.partner_orgs_list_custom_organization)
    ? src.partner_orgs_list_custom_organization
    : [];
  const hasPartnerOrg = partnerOrgs.some(
    (value) => typeof value === "string" && value.trim() === want,
  );
  if (docId !== want && !hasPartnerOrg && parentOrg !== want) {
    return null;
  }

  const geoUnknown = src.address1_geographic_address;
  if (!isRecord(geoUnknown)) return null;
  const lat = geoUnknown.lat;
  const lng = geoUnknown.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  const components = isRecord(geoUnknown.components) ? geoUnknown.components : {};
  const state = typeof components.state === "string" ? components.state : "";
  const stateAbbr =
    typeof components["state code"] === "string" ? components["state code"] : "";
  const city =
    typeof components.city === "string"
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
  const locationCity =
    city && city.trim().length > 0
      ? city.trim()
      : address && address.length > 0
        ? address.split(",")[0]!.trim()
        : "Unknown";
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

    const locationCity =
      city && city.trim().length > 0
        ? city.trim()
        : address && address.length > 0
          ? address.split(",")[0]!.trim()
          : "Unknown";
    const region = normalizeRegion(state, stateAbbr);
    const locationName =
      extractLocationNameFromSeoDescription(d.seo_description_text) ??
      (locationCity === "Unknown"
        ? "AutoRecycler"
        : `AutoRecycler - ${locationCity}`);

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
        try: () => postAutorecyclerElasticsearchMget(buildMgetBody([inventoryIdSeed])),
        catch: (cause) =>
          new AutorecyclerProviderError({
            from: -1,
            cause: new Error(
              `details mget inventoryId=${inventoryIdSeed}: ${cause instanceof Error ? cause.message : String(cause)}`,
              { cause },
            ),
          }),
      }).pipe(
        Effect.tapError((e) =>
          Effect.logError(`[AutoRecycler geo] ${e.message}`),
        ),
        Effect.catchAll(() => Effect.succeed({ docs: [] })),
      );

      const parsedFromOrganization =
        mget.docs
          ?.map((doc) => parseOrgGeoFromOrganizationDoc(doc, orgLookup))
          .find((value) => value !== null) ?? null;
      if (parsedFromOrganization) {
        const now = new Date();
        yield* Effect.tryPromise({
          try: () =>
            dbClient
              .insert(autorecyclerOrgGeo)
              .values({
                orgLookup: parsedFromOrganization.orgLookup,
                lat: parsedFromOrganization.lat,
                lng: parsedFromOrganization.lng,
                locationName: parsedFromOrganization.locationName,
                locationCity: parsedFromOrganization.locationCity,
                state: parsedFromOrganization.state,
                stateAbbr: parsedFromOrganization.stateAbbr,
                address: parsedFromOrganization.address ?? null,
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

        memory.set(orgLookup, parsedFromOrganization);
        return parsedFromOrganization;
      }

      const website = yield* Effect.tryPromise({
        try: async () => {
          const res = await postAutorecyclerElasticsearchMsearch(
            buildWebsiteLookupMsearchBody(orgLookup),
          );
          const src = res.responses?.[0]?.hits?.hits?.[0]?._source;
          return src && typeof src === "object"
            ? (src as Record<string, unknown>)
            : null;
        },
        catch: (cause) =>
          new AutorecyclerProviderError({
            from: -1,
            cause: new Error(`website msearch orgLookup=${orgLookup}: ${cause instanceof Error ? cause.message : String(cause)}`, {
              cause,
            }),
          }),
      }).pipe(
        Effect.tapError((e) =>
          Effect.logError(`[AutoRecycler geo] ${e.message}`),
        ),
      );

      const parsedFromWebsite = website
        ? parseOrgGeoFromWebsiteRecord(website, orgLookup)
        : null;
      if (parsedFromWebsite) {
        const now = new Date();
        yield* Effect.tryPromise({
          try: () =>
            dbClient
              .insert(autorecyclerOrgGeo)
              .values({
                orgLookup: parsedFromWebsite.orgLookup,
                lat: parsedFromWebsite.lat,
                lng: parsedFromWebsite.lng,
                locationName: parsedFromWebsite.locationName,
                locationCity: parsedFromWebsite.locationCity,
                state: parsedFromWebsite.state,
                stateAbbr: parsedFromWebsite.stateAbbr,
                address: parsedFromWebsite.address ?? null,
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

        memory.set(orgLookup, parsedFromWebsite);
        return parsedFromWebsite;
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
              locationCity: parsed.locationCity,
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
                locationCity: sql`excluded.location_city`,
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
