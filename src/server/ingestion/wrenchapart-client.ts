import { Data, Effect, Schema } from "effect";
import {
  fetchProviderJson,
  type ProviderRequestGate,
  type ProviderRetryPolicy,
} from "./provider-http-client";

export const WRENCHAPART_API_ORIGIN = "https://api.wrenchapart.com";

export class WrenchApartProviderError extends Data.TaggedError(
  "WrenchApartProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return `Wrench-A-Part ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

const retry = {
  retryLimit: 2,
  retryBaseDelayMs: 1_000,
  retryNetworkErrors: false,
  jitter: false,
} satisfies Partial<ProviderRetryPolicy>;

const id = Schema.Number.pipe(Schema.int(), Schema.positive());
const optionalText = Schema.optional(Schema.NullOr(Schema.String));
const optionalNumber = Schema.optional(Schema.NullOr(Schema.Number));
const namedItem = Schema.Struct({ name: Schema.String });

export const WrenchApartLocationSchema = Schema.Struct({
  id,
  name: optionalText,
  slug: optionalText,
  street: optionalText,
  city: optionalText,
  state: optionalText,
  zip: optionalText,
  phone: optionalText,
  geoLat: optionalNumber,
  geoLng: optionalNumber,
});

export type WrenchApartLocation = Schema.Schema.Type<
  typeof WrenchApartLocationSchema
>;

export const WrenchApartVehicleSchema = Schema.Struct({
  yard: id,
  vin: optionalText,
  modelYear: optionalNumber,
  make: Schema.optional(Schema.NullOr(namedItem)),
  model: Schema.optional(Schema.NullOr(namedItem)),
  photo: optionalText,
  color: optionalText,
  stockNumber: optionalText,
  dateAdded: optionalText,
  row: Schema.optional(Schema.NullOr(Schema.Struct({ id: optionalNumber }))),
});

export type WrenchApartVehicle = Schema.Schema.Type<
  typeof WrenchApartVehicleSchema
>;

// Both endpoints return bare, unpaginated arrays. Do not introduce an artificial
// page size or slice a yard response: locationId is the supported partition.
function fetchCatalog<A, I>(
  path: string,
  schema: Schema.Schema<A, I>,
  requestGate?: ProviderRequestGate,
) {
  return fetchProviderJson({
    url: `${WRENCHAPART_API_ORIGIN}${path}`,
    context: `Wrench-A-Part GET ${path}`,
    schema,
    requestGate,
    retry,
    onResponse: (response) => {
      if (
        response.status === 206 ||
        response.headers.has("content-range") ||
        response.headers.has("link")
      ) {
        throw new Error(
          "Wrench-A-Part returned a partial or linked catalog response; inspect its pagination contract before resuming ingestion",
        );
      }
    },
  }).pipe(
    Effect.mapError(
      (cause) =>
        new WrenchApartProviderError({ operation: `GET ${path}`, cause }),
    ),
  );
}

export function fetchWrenchApartLocations(requestGate?: ProviderRequestGate) {
  return fetchCatalog(
    "/locations",
    Schema.Array(WrenchApartLocationSchema),
    requestGate,
  );
}

export function fetchWrenchApartVehicles(
  locationId: number,
  requestGate?: ProviderRequestGate,
) {
  return fetchCatalog(
    `/v1/vehicles?locationId=${locationId}`,
    Schema.Array(WrenchApartVehicleSchema),
    requestGate,
  );
}
