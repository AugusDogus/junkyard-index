import { unstable_cache } from "next/cache";
import buildQuery from "odata-query";
import { Effect } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import type { Location, Row52Location, Row52ODataResponse } from "~/lib/types";
import { fetchWithRetry } from "~/server/ingestion/fetch-with-retry";

const ROW52_TIMEOUT_MS = 15_000;
const ROW52_RETRIES = 2;
const ROW52_BASE_DELAY_MS = 1_000;
const RETRYABLE_STATUS_CODES = [429, 502, 503, 504];

function buildODataUrl(endpoint: string, queryString: string): string {
  return `${API_ENDPOINTS.ROW52_BASE}${endpoint}${queryString}`;
}

async function fetchRow52<T>(
  endpoint: string,
  queryString: string = "",
): Promise<Row52ODataResponse<T>> {
  const url = buildODataUrl(endpoint, queryString);
  const response = await Effect.runPromise(
    fetchWithRetry(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        cache: "force-cache",
        next: { revalidate: 300 },
      },
      {
        context: endpoint,
        logPrefix: "[Row52 api]",
        timeoutMs: ROW52_TIMEOUT_MS,
        retries: ROW52_RETRIES,
        baseDelayMs: ROW52_BASE_DELAY_MS,
        retryStatusCodes: RETRYABLE_STATUS_CODES,
      },
    ),
  );

  if (!response.ok) {
    throw new Error(
      `Row52 API error: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<Row52ODataResponse<T>>;
}

function transformRow52Location(row52Location: Row52Location): Location {
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

async function fetchLocationsFromRow52Internal(): Promise<Location[]> {
  try {
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

    const response = await fetchRow52<Row52Location>(
      API_ENDPOINTS.ROW52_LOCATIONS,
      queryString,
    );

    return response.value.map(transformRow52Location);
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

    const response = await fetchRow52<{ id: number; name: string }>(
      API_ENDPOINTS.ROW52_MAKES,
      queryString,
    );
    return response.value;
  } catch (error) {
    console.error("Error fetching makes from Row52:", error);
    return [];
  }
}
