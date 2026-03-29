export const LOCATION_PREFERENCE_STORAGE_KEY =
  "junkyard-index:location-preference";

export const LOCATION_PREFERENCE_MODES = ["auto", "zip"] as const;

export type LocationPreferenceMode = (typeof LOCATION_PREFERENCE_MODES)[number];

export interface StoredLocationPreference {
  mode: LocationPreferenceMode;
  zipCode: string | null;
  lat: number | null;
  lng: number | null;
}

export function normalizeZipCode(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  return /^\d{5}$/.test(digits) ? digits : null;
}

export function hasFiniteCoordinates(value: {
  lat: number | null;
  lng: number | null;
}): value is { lat: number; lng: number } {
  return (
    typeof value.lat === "number" &&
    Number.isFinite(value.lat) &&
    typeof value.lng === "number" &&
    Number.isFinite(value.lng) &&
    Math.abs(value.lat) <= 90 &&
    Math.abs(value.lng) <= 180
  );
}

export function isLocationPreferenceMode(
  value: unknown,
): value is LocationPreferenceMode {
  return (
    value === LOCATION_PREFERENCE_MODES[0] ||
    value === LOCATION_PREFERENCE_MODES[1]
  );
}

export function parseStoredLocationPreference(
  value: unknown,
): StoredLocationPreference | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (!isLocationPreferenceMode(record.mode)) {
    return null;
  }

  const zipCode =
    typeof record.zipCode === "string"
      ? normalizeZipCode(record.zipCode)
      : null;
  const lat = typeof record.lat === "number" ? record.lat : null;
  const lng = typeof record.lng === "number" ? record.lng : null;

  if (
    (lat !== null && !Number.isFinite(lat)) ||
    (lng !== null && !Number.isFinite(lng))
  ) {
    return null;
  }

  return {
    mode: record.mode,
    zipCode,
    lat,
    lng,
  };
}
