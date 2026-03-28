import { calculateDistance } from "~/lib/utils";
import type { DataSource, SearchVehicle } from "~/lib/types";

function parseDataSource(value: unknown): DataSource {
  if (value === "pyp" || value === "row52" || value === "autorecycler") {
    return value;
  }
  return "pyp";
}

function getLocationDisplayName(locationName: string): string {
  return locationName
    .replace(/^Pick Your Part - /, "")
    .replace(/^PICK-n-PULL /, "")
    .replace(/^LKQ Pull-A-Part - /, "");
}

export function algoliaHitToSearchVehicle(
  hit: Record<string, unknown>,
  userLocation?: { lat: number; lng: number },
): SearchVehicle {
  const geoloc = hit._geoloc as { lat: number; lng: number } | undefined;
  const lat = geoloc?.lat ?? 0;
  const lng = geoloc?.lng ?? 0;
  const source = parseDataSource(hit.source);
  const locationName = (hit.locationName as string) ?? "";
  const missingSinceAtSeconds =
    typeof hit.missingSinceAt === "number" ? hit.missingSinceAt : null;
  const missingSinceAt =
    missingSinceAtSeconds !== null
      ? new Date(missingSinceAtSeconds * 1000).toISOString()
      : undefined;

  return {
    id: (hit.objectID as string) ?? (hit.vin as string) ?? "",
    year: (hit.year as number) ?? 0,
    make: (hit.make as string) ?? "",
    model: (hit.model as string) ?? "",
    color: (hit.color as string) ?? "",
    vin: (hit.vin as string) ?? (hit.objectID as string) ?? "",
    stockNumber: (hit.stockNumber as string) ?? "",
    availableDate: (hit.availableDate as string) ?? "",
    source,
    locationCode: (hit.locationCode as string) ?? "",
    locationName,
    locationDisplayName: getLocationDisplayName(locationName),
    state: (hit.state as string) ?? "",
    stateAbbr: (hit.stateAbbr as string) ?? "",
    lat,
    lng,
    distance:
      userLocation && geoloc
        ? calculateDistance(userLocation.lat, userLocation.lng, lat, lng)
        : 0,
    section: (hit.section as string) ?? "",
    row: (hit.row as string) ?? "",
    space: (hit.space as string) ?? "",
    imageUrl: (hit.imageUrl as string) ?? null,
    detailsUrl: (hit.detailsUrl as string) ?? "",
    partsUrl: (hit.partsUrl as string) ?? "",
    pricesUrl: (hit.pricesUrl as string) ?? "",
    engine: (hit.engine as string) ?? undefined,
    trim: (hit.trim as string) ?? undefined,
    transmission: (hit.transmission as string) ?? undefined,
    isMissing: (hit.isMissing as boolean) ?? false,
    missingSinceAt,
    missingRunCount: (hit.missingRunCount as number) ?? 0,
  };
}
