import { Duration, Effect, Schedule, Schema } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import {
  RequestTimeoutError,
  RetryableHttpStatusError,
} from "./errors";

const DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504] as const;
const FETCH_TIMEOUT_MS = 30_000;
const RETRY_LIMIT = 2;
const RETRY_BASE_DELAY_MS = 1_000;

function isRetryablePullapartError(error: unknown): boolean {
  return (
    error instanceof RetryableHttpStatusError ||
    error instanceof RequestTimeoutError
  );
}

function buildRetrySchedule() {
  return Schedule.intersect(
    Schedule.recurs(RETRY_LIMIT),
    Schedule.exponential(Duration.millis(RETRY_BASE_DELAY_MS), 2),
  );
}

function pullapartJsonRequest<T, I, R>(params: {
  url: string;
  context: string;
  schema: Schema.Schema<T, I, R>;
  method?: "GET" | "POST";
  body?: string;
}): Effect.Effect<T, Error, R> {
  const retrySchedule = buildRetrySchedule();

  return Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(params.url, {
          method: params.method ?? "GET",
          body: params.body,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json",
            ...(params.body ? { "Content-Type": "application/json" } : {}),
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
      catch: (cause) =>
        cause instanceof DOMException && cause.name === "TimeoutError"
          ? new RequestTimeoutError({
              context: params.context,
              cause: new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms`),
            })
          : new Error(String(cause)),
    });

    if (
      DEFAULT_RETRYABLE_STATUS_CODES.includes(
        response.status as (typeof DEFAULT_RETRYABLE_STATUS_CODES)[number],
      )
    ) {
      return yield* Effect.fail(
        new RetryableHttpStatusError({
          context: params.context,
          status: response.status,
        }),
      );
    }

    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new Error(`${params.context} API error: ${response.status}`),
      );
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (cause) =>
        new Error(`${params.context} returned invalid JSON: ${String(cause)}`),
    });
    return yield* Schema.decodeUnknown(params.schema)(json);
  }).pipe(
    Effect.retry(
      retrySchedule.pipe(
        Schedule.whileInput<Error>((error) => isRetryablePullapartError(error)),
      ),
    ),
  );
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

export type PullapartLocation = Schema.Schema.Type<typeof PullapartLocationSchema>;

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

export type PullapartVehicle = Schema.Schema.Type<typeof PullapartVehicleSchema>;
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
): Effect.Effect<PullapartMake[], Error> {
  const url = new URL(
    `${API_ENDPOINTS.PULLAPART_INVENTORY_BASE}/Make/OnYard`,
  );
  url.searchParams.set("locations", String(locationId));
  return pullapartJsonRequest({
    url: url.toString(),
    context: `Pull-A-Part makes on yard for location=${locationId}`,
    schema: Schema.Array(PullapartMakeSchema),
  }).pipe(Effect.map((makes) => [...makes]));
}

export function searchPullapartVehicles(params: {
  locationId: number;
  makeId: number;
}): Effect.Effect<PullapartVehicleSearchGroup[], Error> {
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
  }).pipe(Effect.map((groups) => [...groups]));
}

export const fetchPullapartVehiclesByMake = searchPullapartVehicles;

export function fetchPullapartVehicleExtendedInfo(params: {
  locationId: number;
  ticketId: number;
  lineId: number;
}): Effect.Effect<PullapartVehicleExtendedInfo, Error> {
  return pullapartJsonRequest({
    url: `${API_ENDPOINTS.PULLAPART_INVENTORY_BASE}/VehicleExtendedInfo/${params.locationId}/${params.ticketId}/${params.lineId}`,
    context: `Pull-A-Part vehicle extended info location=${params.locationId} ticket=${params.ticketId} line=${params.lineId}`,
    schema: PullapartVehicleExtendedInfoSchema,
  });
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
  }).pipe(
    Effect.map((response: PullapartImageResponse) => {
      const webPath = response.webPath.trim();
      return webPath && webPath !== "Error retrieving image" ? webPath : null;
    }),
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
        new Error(`ZIP geocode ${normalizedZipCode} returned invalid coordinates`),
      );
    }

    return { lat, lng };
  });
}
