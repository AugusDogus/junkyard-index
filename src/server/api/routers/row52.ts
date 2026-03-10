import {
  FetchHttpClient,
  HttpClient,
} from "@effect/platform";
import { unstable_cache } from "next/cache";
import buildQuery from "odata-query";
import { Effect, Schema } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import type { Location } from "~/lib/types";
import { fetchRow52OData } from "~/server/ingestion/row52-transport";

const ROW52_TIMEOUT_MS = 15_000;
const ROW52_RETRIES = 2;
const ROW52_BASE_DELAY_MS = 1_000;

type Row52LocationRecord = Schema.Schema.Type<typeof Row52LocationSchema>;

const Row52StateSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  abbreviation: Schema.String,
  countryId: Schema.Number,
});

const Row52LocationSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  code: Schema.String,
  address1: Schema.String,
  city: Schema.String,
  zipCode: Schema.String,
  phone: Schema.String,
  hours: Schema.String,
  latitude: Schema.Number,
  longitude: Schema.Number,
  isActive: Schema.Boolean,
  isVisible: Schema.Boolean,
  isParticipating: Schema.Boolean,
  webUrl: Schema.String,
  logoUrl: Schema.NullOr(Schema.String),
  partsPricingUrl: Schema.String,
  stateId: Schema.Number,
  state: Schema.optional(Row52StateSchema),
});

const Row52MakeSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
});

function transformRow52Location(row52Location: Row52LocationRecord): Location {
  return {
    locationCode: row52Location.id.toString(),
    locationPageURL: row52Location.webUrl || "",
    name: row52Location.name,
    displayName: row52Location.name.replace("PICK-n-PULL ", ""),
    address: row52Location.address1,
    city: row52Location.city,
    state: row52Location.state?.name || "",
    stateAbbr: row52Location.state?.abbreviation || "",
    zip: row52Location.zipCode,
    phone: row52Location.phone,
    lat: row52Location.latitude,
    lng: row52Location.longitude,
    distance: 0,
    legacyCode: row52Location.code,
    primo: "",
    source: "row52",
    urls: {
      store: row52Location.webUrl || "",
      interchange: "",
      inventory: row52Location.webUrl || "",
      prices: row52Location.partsPricingUrl || "",
      directions: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        `${row52Location.address1} ${row52Location.city} ${row52Location.state?.name || ""} ${row52Location.zipCode}`,
      )}&dir_action=navigate`,
      sellACar: "",
      contact: "",
      customerServiceChat: null,
      carbuyChat: null,
      deals: "",
      parts: row52Location.partsPricingUrl || "",
    },
  };
}

function runRow52Boundary<A>(
  program: Effect.Effect<A, Error, HttpClient.HttpClient>,
): Promise<A> {
  return Effect.runPromise(program.pipe(Effect.provide(FetchHttpClient.layer)));
}

function fetchLocationsFromRow52Effect(): Effect.Effect<
  Location[],
  Error,
  HttpClient.HttpClient
> {
  const queryString = buildQuery({
    orderBy: "state/name",
    select: [
      "id",
      "name",
      "code",
      "address1",
      "city",
      "zipCode",
      "phone",
      "hours",
      "latitude",
      "longitude",
      "isActive",
      "isVisible",
      "isParticipating",
      "webUrl",
      "logoUrl",
      "partsPricingUrl",
      "stateId",
    ],
    expand: "state($select=id,name,abbreviation,countryId)",
    filter: { isParticipating: true },
  });

  return fetchRow52OData({
    endpoint: API_ENDPOINTS.ROW52_LOCATIONS,
    queryString,
    itemSchema: Row52LocationSchema,
    timeoutMs: ROW52_TIMEOUT_MS,
    retryLimit: ROW52_RETRIES,
    retryBaseDelayMs: ROW52_BASE_DELAY_MS,
  }).pipe(Effect.map((response) => response.value.map(transformRow52Location)));
}

async function fetchLocationsFromRow52Internal(): Promise<Location[]> {
  try {
    return await runRow52Boundary(fetchLocationsFromRow52Effect());
  } catch (error) {
    console.error("Error fetching locations from Row52:", error);
    return [];
  }
}

export const fetchLocationsFromRow52 = unstable_cache(
  fetchLocationsFromRow52Internal,
  ["row52-locations"],
  {
    revalidate: 3600,
    tags: ["row52-locations"],
  },
);

export async function fetchMakesFromRow52(): Promise<
  Array<{ id: number; name: string }>
> {
  try {
    const queryString = buildQuery({
      orderBy: "name asc",
    });

    const response = await runRow52Boundary(
      fetchRow52OData({
        endpoint: API_ENDPOINTS.ROW52_MAKES,
        queryString,
        itemSchema: Row52MakeSchema,
        timeoutMs: ROW52_TIMEOUT_MS,
        retryLimit: ROW52_RETRIES,
        retryBaseDelayMs: ROW52_BASE_DELAY_MS,
      }),
    );
    return response.value;
  } catch (error) {
    console.error("Error fetching makes from Row52:", error);
    return [];
  }
}
