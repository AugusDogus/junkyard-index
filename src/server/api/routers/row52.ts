import { unstable_cache } from "next/cache";
import buildQuery from "odata-query";
import { API_ENDPOINTS } from "~/lib/constants";
import type {
  Location,
  Row52Location,
  Row52ODataResponse,
  Row52Vehicle,
  Vehicle,
  VehicleImage,
} from "~/lib/types";

function buildODataUrl(endpoint: string, queryString: string): string {
  return `${API_ENDPOINTS.ROW52_BASE}${endpoint}${queryString}`;
}

async function fetchRow52<T>(
  endpoint: string,
  queryString: string = "",
): Promise<Row52ODataResponse<T>> {
  const url = buildODataUrl(endpoint, queryString);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json",
    },
    cache: "force-cache",
    next: { revalidate: 300 }, // Cache for 5 minutes
  });

  if (!response.ok) {
    throw new Error(`Row52 API error: ${response.status} ${response.statusText}`);
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
    distance: 0, // Will be calculated based on user location
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

function transformRow52Vehicle(
  row52Vehicle: Row52Vehicle,
  location: Location,
): Vehicle {
  const images: VehicleImage[] = [];

  if (row52Vehicle.images && row52Vehicle.images.length > 0) {
    for (const img of row52Vehicle.images) {
      if (!img.isActive || !img.isVisible) continue;

      const baseUrl = img.resourceUrl || `${API_ENDPOINTS.ROW52_CDN}/images/`;
      const ext = img.extension || ".JPG";
      images.push({ url: `${baseUrl}${img.size1}${ext}` });
    }
  }

  return {
    id: `row52-${row52Vehicle.id}`,
    year: row52Vehicle.year,
    make: row52Vehicle.model?.make?.name || "",
    model: row52Vehicle.model?.name || "",
    color: row52Vehicle.color || "",
    vin: row52Vehicle.vin,
    stockNumber: row52Vehicle.barCodeNumber,
    availableDate: row52Vehicle.dateAdded,
    location,
    source: "row52",
    yardLocation: {
      section: "",
      row: row52Vehicle.row || "",
      space: row52Vehicle.slot || "",
    },
    images,
    detailsUrl: `https://row52.com/Vehicle/Index/${row52Vehicle.vin}`,
    partsUrl: location.urls.parts,
    pricesUrl: location.urls.prices,
    engine: row52Vehicle.engine ?? undefined,
    trim: row52Vehicle.trim ?? undefined,
    transmission: row52Vehicle.transmission ?? undefined,
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
    revalidate: 3600, // Cache for 1 hour
    tags: ["row52-locations"],
  },
);

/**
 * Build the OData filter for vehicle search.
 * Uses odata-query library which automatically escapes string values.
 */
function buildVehicleFilter(query: string): Record<string, unknown> {
  const searchTerm = query.trim().toLowerCase();

  if (!searchTerm) {
    return { isActive: true };
  }

  // Use odata-query object syntax for automatic escaping
  return {
    isActive: true,
    or: [
      { "tolower(model/name)": { contains: searchTerm } },
      { "tolower(model/make/name)": { contains: searchTerm } },
    ],
  };
}

async function fetchVehiclesFromRow52Internal(
  query: string,
  locationMap: Map<number, Location>,
): Promise<Vehicle[]> {
  try {
    const queryString = buildQuery({
      filter: buildVehicleFilter(query),
      expand: ["model($expand=make)", "location($expand=state)", "images"],
      orderBy: "dateAdded desc",
      top: 1000,
    });

    const response = await fetchRow52<Row52Vehicle>(
      API_ENDPOINTS.ROW52_VEHICLES,
      queryString,
    );

    return response.value
      .map((vehicle) => {
        let location = locationMap.get(vehicle.locationId);
        if (!location && vehicle.location) {
          location = transformRow52Location(vehicle.location);
        }
        if (!location) {
          return null;
        }
        return transformRow52Vehicle(vehicle, location);
      })
      .filter((v): v is Vehicle => v !== null);
  } catch (error) {
    console.error("Error fetching vehicles from Row52:", error);
    return [];
  }
}

export const fetchVehiclesFromRow52 = unstable_cache(
  async (query: string) => {
    const locations = await fetchLocationsFromRow52();
    const locationMap = new Map<number, Location>();
    locations.forEach((loc) => {
      locationMap.set(parseInt(loc.locationCode), loc);
    });

    return fetchVehiclesFromRow52Internal(query, locationMap);
  },
  ["row52-vehicles"],
  {
    revalidate: 300, // Cache for 5 minutes
    tags: ["row52-vehicles"],
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
