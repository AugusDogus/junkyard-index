import { Effect, Schema } from "effect";
import type { Yard } from "~/lib/yard";
import { normalizeRegion } from "./normalization";
import { fetchZipGeo } from "./pullapart-client";
import type { PullNSaveVehicle } from "./pullnsave-client";
import {
  PULLNSAVE_INVENTORY_PAGE_URL,
  PULLNSAVE_YARDS,
  type PullNSaveYard,
} from "./pullnsave-config";
import {
  fetchProviderJson,
  fetchProviderText,
  type ProviderRequestGate,
} from "./provider-http-client";
import { pullnsaveYard } from "./yard-metadata";

const DIRECTORY_URL = "https://www.pullnsave.com/wp-admin/admin-ajax.php";
const HEADERS = { "User-Agent": "JunkyardIndex/1.0" };
const DirectoryBootstrapSchema = Schema.Struct({ nonce: Schema.String });
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
  | { status: "unresolved"; yardNumber: number; reason: string };

function fetchDirectoryNonce(requestGate: ProviderRequestGate) {
  return fetchProviderText({
    url: PULLNSAVE_INVENTORY_PAGE_URL,
    context: "Pull-N-Save public yard directory bootstrap",
    headers: HEADERS,
    requestGate,
  }).pipe(
    Effect.flatMap((html) =>
      Effect.try({
        try: () => {
          const payload = /var\s+pns_inventory_sf_ajax\s*=\s*(\{[^;]+\})/.exec(
            html,
          )?.[1];
          if (!payload)
            throw new Error(
              "Pull-N-Save inventory page did not provide its public directory bootstrap",
            );
          return Schema.decodeUnknownSync(DirectoryBootstrapSchema)(
            JSON.parse(payload),
          ).nonce;
        },
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      }),
    ),
  );
}

/** Previously verified locations are a metadata cache, not a supported-yard allowlist. */
export function createPullNSaveYardResolver(requestGate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const nonce = yield* Effect.cached(fetchDirectoryNonce(requestGate));
    const resolved = new Map<number, PullNSaveYardResolution>(
      PULLNSAVE_YARDS.map((yard) => [
        yard.yardNumber,
        { status: "resolved", yard, metadata: pullnsaveYard(yard) },
      ]),
    );

    return (record: PullNSaveVehicle): Effect.Effect<PullNSaveYardResolution> =>
      Effect.gen(function* () {
        const cached = resolved.get(record.astStoreNumber);
        if (cached) return cached;

        const lookup = yield* Effect.gen(function* () {
          const security = yield* nonce;
          const response = yield* fetchProviderJson({
            url: DIRECTORY_URL,
            context: `Pull-N-Save public yard metadata for store ${record.astStoreNumber}`,
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
              yearStart: String(record.year ?? 0),
              yearEnd: String(record.year ?? 0),
              make: record.make ?? "",
              model: "0",
              "yard[]": String(record.astStoreNumber),
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
            (row) => row?.astStoreNumber === record.astStoreNumber,
          );
          const details = entries.find(
            (row) =>
              row?.yardName?.trim() &&
              row.yardAddress?.trim() &&
              row.yardZip?.trim(),
          );
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
          const coordinates = yield* requestGate(fetchZipGeo(zipCode));
          if (Math.abs(coordinates.lat) > 90 || Math.abs(coordinates.lng) > 180)
            return yield* Effect.fail(
              new Error("Yard ZIP lookup returned out-of-range coordinates"),
            );
          const yard: PullNSaveYard = {
            yardNumber: record.astStoreNumber,
            code: `PNS-${record.astStoreNumber}`,
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
            metadata: { ...pullnsaveYard(yard), lat: null, lng: null },
          } satisfies PullNSaveYardResolution;
        }).pipe(Effect.either);

        const resolution: PullNSaveYardResolution =
          lookup._tag === "Right"
            ? lookup.right
            : {
                status: "unresolved",
                yardNumber: record.astStoreNumber,
                reason: lookup.left.message,
              };
        resolved.set(record.astStoreNumber, resolution);
        return resolution;
      });
  });
}
