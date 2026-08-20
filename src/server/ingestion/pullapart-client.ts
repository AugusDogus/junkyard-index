import { Data, Effect, Schema } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import {
  fetchProviderJson,
  type ProviderRequestGate,
  type ProviderRetryPolicy,
} from "./provider-http-client";

const PULLAPART_RETRY_POLICY = {
  retryLimit: 5,
  retryBaseDelayMs: 2_000,
  retryNetworkErrors: false,
} satisfies Partial<ProviderRetryPolicy>;

export type PullapartRequestGate = ProviderRequestGate;

class PullapartNoDataError extends Data.TaggedError("PullapartNoDataError")<{
  context: string;
}> {
  override get message() {
    return `${this.context} returned no data`;
  }
}

export function isPullapartNoDataError(
  error: unknown,
): error is PullapartNoDataError {
  return error instanceof PullapartNoDataError;
}

function pullapartJsonRequest<T, I, R>(params: {
  url: string;
  context: string;
  schema: Schema.Schema<T, I, R>;
  method?: "GET" | "POST";
  body?: string;
  notFoundIsNoData?: boolean;
  requestGate?: PullapartRequestGate;
}): Effect.Effect<T, Error, R> {
  return fetchProviderJson({
    url: params.url,
    context: params.context,
    schema: params.schema,
    method: params.method,
    body: params.body,
    headers: {
      Accept: "application/json",
      ...(params.body ? { "Content-Type": "application/json" } : {}),
    },
    requestGate: params.requestGate,
    retry: PULLAPART_RETRY_POLICY,
    responseError: (response) => {
      if (response.status === 404 && params.notFoundIsNoData) {
        return new PullapartNoDataError({ context: params.context });
      }
      return new Error(`${params.context} API error: ${response.status}`);
    },
  });
}

export const PullapartMakeSchema = Schema.Struct({
  makeID: Schema.Number,
  makeName: Schema.String,
  rareFind: Schema.Boolean,
  dateModified: Schema.String,
  dateCreated: Schema.String,
});

export type PullapartMake = Schema.Schema.Type<typeof PullapartMakeSchema>;

export const PullapartLocationSchema = Schema.Struct({
  idNumber: Schema.Number,
  nameItem: Schema.String,
  locationID: Schema.Number,
  locationName: Schema.String,
  address1: Schema.String,
  address2: Schema.String,
  cityName: Schema.String,
  stateName: Schema.String,
  zipCode: Schema.String,
  siteTypeID: Schema.Number,
  phone: Schema.String,
  phoneCarBuying: Schema.String,
  phoneUsedCar: Schema.NullOr(Schema.String),
  distanceInMiles: Schema.Number,
  taxRate: Schema.Number,
  warrantyDays: Schema.Number,
  coreDays: Schema.Number,
  allowsCashReturns: Schema.Number,
  email: Schema.String,
  passcodeForMiscItems: Schema.Union(Schema.Boolean, Schema.String),
  retailEmail: Schema.String,
  environmentalFeeRate: Schema.Number,
  environmentalFeeCap: Schema.Number,
  locationShortName: Schema.String,
});

export type PullapartLocation = Schema.Schema.Type<
  typeof PullapartLocationSchema
>;

export const PullapartVehicleSchema = Schema.Struct({
  vinID: Schema.Number,
  ticketID: Schema.Number,
  lineID: Schema.Number,
  locID: Schema.Number,
  locName: Schema.String,
  makeID: Schema.Number,
  makeName: Schema.String,
  modelID: Schema.Number,
  modelName: Schema.String,
  modelYear: Schema.Number,
  row: Schema.Union(Schema.Number, Schema.String),
  vin: Schema.String,
  dateYardOn: Schema.NullOr(Schema.String),
  vinDecodedId: Schema.NullOr(Schema.Number),
  extendedInfo: Schema.NullOr(Schema.Unknown),
});

export type PullapartVehicle = Schema.Schema.Type<
  typeof PullapartVehicleSchema
>;
export type PullapartSearchVehicle = PullapartVehicle;

export const PullapartVehicleExtendedInfoSchema = Schema.Struct({
  trim: Schema.optional(Schema.NullOr(Schema.String)),
  driveType: Schema.optional(Schema.NullOr(Schema.String)),
  fuelType: Schema.optional(Schema.NullOr(Schema.String)),
  engineBlock: Schema.optional(Schema.NullOr(Schema.String)),
  engineCylinders: Schema.optional(
    Schema.NullOr(Schema.Union(Schema.Number, Schema.String)),
  ),
  engineSize: Schema.optional(
    Schema.NullOr(Schema.Union(Schema.Number, Schema.String)),
  ),
  engineAspiration: Schema.optional(Schema.NullOr(Schema.String)),
  transType: Schema.optional(Schema.NullOr(Schema.String)),
  transSpeeds: Schema.optional(
    Schema.NullOr(Schema.Union(Schema.Number, Schema.String)),
  ),
  style: Schema.optional(Schema.NullOr(Schema.String)),
  color: Schema.optional(Schema.NullOr(Schema.String)),
});

export type PullapartVehicleExtendedInfo = Schema.Schema.Type<
  typeof PullapartVehicleExtendedInfoSchema
>;

const PullapartImageResponseSchema = Schema.Struct({
  webPath: Schema.String,
  filePath: Schema.String,
});

type PullapartImageResponse = Schema.Schema.Type<
  typeof PullapartImageResponseSchema
>;

export const PullapartVehicleSearchGroupSchema = Schema.Struct({
  locationID: Schema.Number,
  exact: Schema.Array(PullapartVehicleSchema),
  other: Schema.Array(PullapartVehicleSchema),
  inventory: Schema.NullOr(Schema.Unknown),
});

export type PullapartVehicleSearchGroup = Schema.Schema.Type<
  typeof PullapartVehicleSearchGroupSchema
>;

export interface ResolvedPullapartLocation extends PullapartLocation {
  lat: number;
  lng: number;
}

const PullapartZipGeoSchema = Schema.Struct({
  places: Schema.Array(
    Schema.Struct({
      latitude: Schema.String,
      longitude: Schema.String,
      "place name": Schema.String,
      state: Schema.String,
      "state abbreviation": Schema.String,
    }),
  ),
});

export interface PullapartZipGeo {
  lat: number;
  lng: number;
}

export function fetchPullapartLocations(): Effect.Effect<
  PullapartLocation[],
  Error
> {
  return pullapartJsonRequest({
    url: `${API_ENDPOINTS.PULLAPART_EXTERNAL_INTERCHANGE_BASE}/interchange/GetLocations`,
    context: "Pull-A-Part locations",
    schema: Schema.Array(PullapartLocationSchema),
  }).pipe(Effect.map((locations) => [...locations]));
}

export function fetchPullapartMakesOnYard(
  locationId: number,
  requestGate?: PullapartRequestGate,
): Effect.Effect<PullapartMake[], Error> {
  const url = new URL(`${API_ENDPOINTS.PULLAPART_INVENTORY_BASE}/Make/OnYard`);
  url.searchParams.set("locations", String(locationId));
  return pullapartJsonRequest({
    url: url.toString(),
    context: `Pull-A-Part makes on yard for location=${locationId}`,
    schema: Schema.Array(PullapartMakeSchema),
    requestGate,
  }).pipe(Effect.map((makes) => [...makes]));
}

export function searchPullapartVehicles(
  params: {
    locationId: number;
    makeId: number;
  },
  requestGate?: PullapartRequestGate,
): Effect.Effect<PullapartVehicleSearchGroup[], Error> {
  return pullapartJsonRequest({
    url: `${API_ENDPOINTS.PULLAPART_INVENTORY_BASE}/Vehicle/Search`,
    context: `Pull-A-Part vehicle search location=${params.locationId} make=${params.makeId}`,
    schema: Schema.Array(PullapartVehicleSearchGroupSchema),
    method: "POST",
    body: JSON.stringify({
      Locations: [params.locationId],
      MakeID: params.makeId,
      Models: [],
      Years: [],
    }),
    requestGate,
  }).pipe(Effect.map((groups) => [...groups]));
}

export const fetchPullapartVehiclesByMake = searchPullapartVehicles;

export function fetchPullapartVehicleExtendedInfo(
  params: {
    locationId: number;
    ticketId: number;
    lineId: number;
  },
  requestGate?: PullapartRequestGate,
): Effect.Effect<PullapartVehicleExtendedInfo | null, Error> {
  return pullapartJsonRequest({
    url: `${API_ENDPOINTS.PULLAPART_INVENTORY_BASE}/VehicleExtendedInfo/${params.locationId}/${params.ticketId}/${params.lineId}`,
    context: `Pull-A-Part vehicle extended info location=${params.locationId} ticket=${params.ticketId} line=${params.lineId}`,
    schema: PullapartVehicleExtendedInfoSchema,
    notFoundIsNoData: true,
    requestGate,
  }).pipe(Effect.catchIf(isPullapartNoDataError, () => Effect.succeed(null)));
}

export function fetchPullapartVehicleImage(params: {
  locationId: number;
  ticketId: number;
  lineId: number;
}): Effect.Effect<string | null, Error> {
  const url = new URL("https://imageservice.pullapart.com/img/retrieveimage/");
  url.searchParams.set("locID", String(params.locationId));
  url.searchParams.set("ticketID", String(params.ticketId));
  url.searchParams.set("lineID", String(params.lineId));
  url.searchParams.set("programID", "35");
  url.searchParams.set("imageIndex", "1");

  return pullapartJsonRequest({
    url: url.toString(),
    context: `Pull-A-Part vehicle image location=${params.locationId} ticket=${params.ticketId} line=${params.lineId}`,
    schema: PullapartImageResponseSchema,
    notFoundIsNoData: true,
  }).pipe(
    Effect.map((response: PullapartImageResponse) => {
      const webPath = response.webPath.trim();
      return webPath && webPath !== "Error retrieving image" ? webPath : null;
    }),
    Effect.catchIf(isPullapartNoDataError, () => Effect.succeed(null)),
  );
}

export function fetchZipGeo(
  zipCode: string,
): Effect.Effect<PullapartZipGeo, Error> {
  const normalizedZipCode = zipCode.trim().slice(0, 5);
  return Effect.gen(function* () {
    const response = yield* pullapartJsonRequest({
      url: `https://api.zippopotam.us/us/${normalizedZipCode}`,
      context: `ZIP geocode ${normalizedZipCode}`,
      schema: PullapartZipGeoSchema,
    });
    const place = response.places[0];
    if (!place) {
      return yield* Effect.fail(
        new Error(`ZIP geocode ${normalizedZipCode} returned no places`),
      );
    }

    const lat = Number.parseFloat(place.latitude);
    const lng = Number.parseFloat(place.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return yield* Effect.fail(
        new Error(
          `ZIP geocode ${normalizedZipCode} returned invalid coordinates`,
        ),
      );
    }

    return { lat, lng };
  });
}
