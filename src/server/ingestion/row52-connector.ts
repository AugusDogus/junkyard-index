import buildQuery from "odata-query";
import { API_ENDPOINTS } from "~/lib/constants";
import type {
  Row52Image,
  Row52Location,
  Row52ODataResponse,
  Row52Vehicle,
} from "~/lib/types";
import type { CanonicalVehicle, IngestionResult } from "./types";

const PAGE_SIZE = 1000;

async function fetchRow52<T>(
  endpoint: string,
  queryString: string,
): Promise<Row52ODataResponse<T>> {
  const url = `${API_ENDPOINTS.ROW52_BASE}${endpoint}${queryString}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Row52 API error: ${response.status} ${response.statusText}`,
    );
  }

  return response.json() as Promise<Row52ODataResponse<T>>;
}

function buildImageUrl(img: Row52Image): string | null {
  if (!img.isActive || !img.isVisible) return null;
  const baseUrl = img.resourceUrl || `${API_ENDPOINTS.ROW52_CDN}/images/`;
  const ext = img.extension || ".JPG";
  return `${baseUrl}${img.size1}${ext}`;
}

function transformRow52Vehicle(
  vehicle: Row52Vehicle,
  locationMap: Map<number, Row52Location>,
): CanonicalVehicle | null {
  const location = vehicle.location ?? locationMap.get(vehicle.locationId);
  if (!location) return null;

  const state = location.state;
  const make = vehicle.model?.make?.name || "";
  const model = vehicle.model?.name || "";

  if (!vehicle.vin) return null;

  // Get primary image URL
  let imageUrl: string | null = null;
  if (vehicle.images && vehicle.images.length > 0) {
    for (const img of vehicle.images) {
      const url = buildImageUrl(img);
      if (url) {
        imageUrl = url;
        break;
      }
    }
  }

  // Build location URLs
  const webUrl = location.webUrl || "";
  const partsPricingUrl = location.partsPricingUrl || "";

  return {
    vin: vehicle.vin,
    source: "row52",
    year: vehicle.year,
    make,
    model,
    color: vehicle.color || null,
    stockNumber: vehicle.barCodeNumber || null,
    imageUrl,
    availableDate: vehicle.dateAdded || null,
    locationCode: location.id.toString(),
    locationName: location.name,
    state: state?.name || "",
    stateAbbr: state?.abbreviation || "",
    lat: location.latitude,
    lng: location.longitude,
    section: null,
    row: vehicle.row || null,
    space: vehicle.slot || null,
    detailsUrl: `https://row52.com/Vehicle/Index/${vehicle.vin}`,
    partsUrl: partsPricingUrl,
    pricesUrl: partsPricingUrl,
    engine: vehicle.engine ?? null,
    trim: vehicle.trim ?? null,
    transmission: vehicle.transmission ?? null,
  };
}

/**
 * Fetch all locations from Row52 to build a location lookup map.
 */
async function fetchRow52Locations(): Promise<Map<number, Row52Location>> {
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
      "latitude",
      "longitude",
      "isActive",
      "isVisible",
      "isParticipating",
      "webUrl",
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

  const map = new Map<number, Row52Location>();
  for (const loc of response.value) {
    map.set(loc.id, loc);
  }
  return map;
}

/**
 * Fetch all active vehicles from Row52, paginating with $top/$skip.
 */
export async function fetchRow52Inventory(): Promise<IngestionResult> {
  const allVehicles: CanonicalVehicle[] = [];
  const allErrors: string[] = [];

  try {
    console.log("[Row52] Fetching locations...");
    const locationMap = await fetchRow52Locations();
    console.log(`[Row52] Found ${locationMap.size} participating locations`);

    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const queryString = buildQuery({
          filter: { isActive: true },
          expand: ["model($expand=make)", "location($expand=state)", "images"],
          orderBy: "dateAdded desc",
          top: PAGE_SIZE,
          skip,
          count: true,
        });

        const response = await fetchRow52<Row52Vehicle>(
          API_ENDPOINTS.ROW52_VEHICLES,
          queryString,
        );

        const totalCount = response["@odata.count"];
        const pageVehicles = response.value;

        console.log(
          `[Row52] Fetched page at skip=${skip}: ${pageVehicles.length} vehicles (total: ${totalCount ?? "unknown"})`,
        );

        for (const rv of pageVehicles) {
          const vehicle = transformRow52Vehicle(rv, locationMap);
          if (vehicle) {
            allVehicles.push(vehicle);
          }
        }

        if (pageVehicles.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          skip += PAGE_SIZE;
        }
      } catch (error) {
        const msg = `Row52 page at skip=${skip}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(msg);
        allErrors.push(msg);
        hasMore = false; // Stop on error
      }
    }

    console.log(
      `[Row52] Total: ${allVehicles.length} vehicles, ${allErrors.length} errors`,
    );
  } catch (error) {
    const msg = `Row52 connector failed: ${error instanceof Error ? error.message : String(error)}`;
    console.error(msg);
    allErrors.push(msg);
  }

  return {
    source: "row52",
    vehicles: allVehicles,
    errors: allErrors,
  };
}
