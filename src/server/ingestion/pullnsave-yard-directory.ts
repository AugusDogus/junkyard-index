import { Effect, Schema } from "effect";
import { Yard } from "~/lib/yard";
import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { yard as yardTable } from "~/schema";
import { normalizeRegion } from "./normalization";
import { fetchZipGeo } from "./pullapart-client";
import {
  PULLNSAVE_INVENTORY_PAGE_URL,
  PULLNSAVE_YARDS,
  type PullNSaveYard,
} from "./pullnsave-config";
import {
  fetchProviderJson,
  type ProviderRequestGate,
} from "./provider-http-client";
import { pullnsaveYard } from "./yard-metadata";
import { fetchPullNSaveYardList } from "./pullnsave-yard-list";

const DIRECTORY_URL = "https://www.pullnsave.com/wp-admin/admin-ajax.php";
const HEADERS = { "User-Agent": "JunkyardIndex/1.0" };
const DirectoryRowSchema = Schema.Struct({
  astStoreNumber: Schema.Number,
  yardName: Schema.optional(Schema.String),
  yardAddress: Schema.optional(Schema.String),
  yardZip: Schema.optional(Schema.String),
});
const DirectoryResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  data: Schema.Array(Schema.NullOr(DirectoryRowSchema)),
});

export type PullNSaveYardResolution =
  | { status: "resolved"; yard: PullNSaveYard; metadata: Yard }
  | { status: "unlisted"; yardNumber: number }
  | { status: "unresolved"; yardNumber: number; reason: string };

/** Previously verified locations are a metadata cache, not a supported-yard allowlist. */
export async function loadCachedPullNSaveYards(
  database: LibSQLDatabase,
): Promise<Yard[]> {
  const rows = await database
    .select()
    .from(yardTable)
    .where(eq(yardTable.source, "pullnsave"));
  return rows.map((row) => {
    const parsed = Yard.parse(row);
    if (!parsed.success)
      throw new Error(
        `Stored Pull-N-Save yard ${row.code} is invalid: ${parsed.error.message}`,
      );
    return parsed.data;
  });
}

export function createPullNSaveYardResolver(
  requestGate: ProviderRequestGate,
  cachedYards: readonly Yard[] = [],
) {
  return Effect.gen(function* () {
    const directory = yield* fetchPullNSaveYardList(requestGate);
    const resolved = new Map<number, PullNSaveYardResolution>(
      PULLNSAVE_YARDS.map((yard) => [
        yard.yardNumber,
        { status: "resolved", yard, metadata: pullnsaveYard(yard) },
      ]),
    );
    const storedYards = new Map(
      cachedYards
        .filter((yard) => yard.source === "pullnsave")
        .map((yard) => [yard.code, yard]),
    );

    return (yardNumber: number): Effect.Effect<PullNSaveYardResolution> =>
      Effect.gen(function* () {
        if (!directory.yardNumbers.has(yardNumber))
          return {
            status: "unlisted",
            yardNumber,
          } satisfies PullNSaveYardResolution;
        const cached = resolved.get(yardNumber);
        if (cached) return cached;

        const lookup = yield* Effect.gen(function* () {
          const stored = storedYards.get(`PNS-${yardNumber}`);
          const cached =
            stored?.address && stored.postalCode ? stored : undefined;
          const details = cached
            ? {
                yardName: cached.name,
                yardAddress: `${cached.address}, ${cached.city}, ${cached.state}`,
                yardZip: cached.postalCode,
              }
            : yield* Effect.gen(function* () {
                const security = directory.nonce;
                const response = yield* fetchProviderJson({
                  url: DIRECTORY_URL,
                  context: `Pull-N-Save public yard metadata for store ${yardNumber}`,
                  method: "POST",
                  headers: {
                    ...HEADERS,
                    "Content-Type": "application/x-www-form-urlencoded",
                    Referer: PULLNSAVE_INVENTORY_PAGE_URL,
                  },
                  body: new URLSearchParams({
                    action: "pns_get_inventory_assets",
                    security,
                    search_type: "0",
                    yearStart: "0",
                    yearEnd: "0",
                    make: "",
                    model: "0",
                    "yard[]": String(yardNumber),
                    zip: "",
                    radius: "0",
                  }).toString(),
                  schema: DirectoryResponseSchema,
                  requestGate,
                });
                if (!response.success)
                  return yield* Effect.fail(
                    new Error("Public yard metadata lookup was unsuccessful"),
                  );
                const entries = response.data.filter(
                  (row) => row?.astStoreNumber === yardNumber,
                );
                return entries.find(
                  (row) =>
                    row?.yardName?.trim() &&
                    row.yardAddress?.trim() &&
                    row.yardZip?.trim(),
                );
              });
          const locationName = details?.yardName?.trim();
          const address = details?.yardAddress?.trim();
          const zipCode = details?.yardZip?.trim();
          const addressParts = address
            ? /^(.*),\s*([^,]+),\s*([A-Za-z]{2})\s*$/.exec(address)
            : null;
          const street = addressParts?.[1]?.trim();
          const city = addressParts?.[2]?.trim();
          const stateAbbr = addressParts?.[3]?.toUpperCase();
          if (
            !locationName ||
            !street ||
            !city ||
            !stateAbbr ||
            !zipCode ||
            !/^\d{5}(?:-\d{4})?$/.test(zipCode)
          ) {
            return yield* Effect.fail(
              new Error(
                "Public inventory did not identify this yard with a name, city/state, address, and ZIP",
              ),
            );
          }
          const region = normalizeRegion(stateAbbr, stateAbbr);
          if (!region.stateAbbr)
            return yield* Effect.fail(
              new Error(
                `Public yard metadata returned an unrecognized state: ${stateAbbr}`,
              ),
            );
          const coordinates =
            cached?.lat !== null &&
            cached?.lat !== undefined &&
            cached.lng !== null
              ? { lat: cached.lat, lng: cached.lng }
              : yield* requestGate(fetchZipGeo(zipCode));
          if (Math.abs(coordinates.lat) > 90 || Math.abs(coordinates.lng) > 180)
            return yield* Effect.fail(
              new Error("Yard ZIP lookup returned out-of-range coordinates"),
            );
          const yard: PullNSaveYard = {
            yardNumber,
            code: `PNS-${yardNumber}`,
            locationName,
            city,
            address: street,
            zipCode,
            ...region,
            ...coordinates,
          };
          // ZIP centroids support vehicle distance search, not precise yard entrances.
          return {
            status: "resolved",
            yard,
            metadata: cached ?? {
              ...pullnsaveYard(yard),
              lat: null,
              lng: null,
            },
          } satisfies PullNSaveYardResolution;
        }).pipe(Effect.either);

        const resolution: PullNSaveYardResolution =
          lookup._tag === "Right"
            ? lookup.right
            : {
                status: "unresolved",
                yardNumber,
                reason: lookup.left.message,
              };
        resolved.set(yardNumber, resolution);
        return resolution;
      });
  });
}
