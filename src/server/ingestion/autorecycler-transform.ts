import { AUTORECYCLER_ORIGIN } from "./autorecycler-client";
import {
  normalizeCanonicalColor,
  parseAutorecyclerMakeModel,
} from "./normalization";
import type { CanonicalVehicle } from "./types";

export type AutorecyclerOrgGeo = {
  orgLookup: string;
  lat: number;
  lng: number;
  locationName: string;
  locationCity: string;
  state: string;
  stateAbbr: string;
  /** Full formatted address when present on `gps_location_geographic_address`. */
  address?: string;
};

function normalizeImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw.startsWith("//")) return `https:${raw}`;
  return raw;
}

function addedDateToIso(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

/** Parse `name_text` like `2000 Nissan Sentra` into year/make/model. */
export function parseAutorecyclerNameText(
  nameText: unknown,
  vehicleYearNumber: unknown,
): { year: number; make: string; model: string } | null {
  const fallbackYear =
    typeof vehicleYearNumber === "number" && Number.isFinite(vehicleYearNumber)
      ? vehicleYearNumber
      : 0;
  const trimmed = typeof nameText === "string" ? nameText.trim() : "";

  if (trimmed.length > 0) {
    const m = /^(\d{4})\s+(.+)$/.exec(trimmed);
    if (m?.[1] && m[2]) {
      const y = Number.parseInt(m[1], 10);
      const year = Number.isFinite(y) ? y : fallbackYear;
      const rest = m[2].trim();
      const { make, model } = parseAutorecyclerMakeModel(rest);
      return {
        year: year || fallbackYear,
        make,
        model,
      };
    }
  }

  if (fallbackYear <= 0 || trimmed.length === 0) {
    return null;
  }

  const { make, model } = parseAutorecyclerMakeModel(trimmed);
  return {
    year: fallbackYear,
    make,
    model,
  };
}

export function transformAutorecyclerMsearchHit(
  src: Record<string, unknown>,
  orgGeo: AutorecyclerOrgGeo,
): CanonicalVehicle | null {
  const vin =
    typeof src.vin_text === "string" && src.vin_text.length > 0
      ? src.vin_text.trim()
      : null;
  if (!vin) return null;

  const inventoryId =
    typeof src.inventory_id_text === "string" ? src.inventory_id_text.trim() : "";
  if (!inventoryId) return null;

  const parts = parseAutorecyclerNameText(src.name_text, src.vehicle_year_number);
  if (!parts) return null;

  const org =
    typeof src.organization_custom_organization === "string"
      ? src.organization_custom_organization.trim()
      : "";
  if (!org || org !== orgGeo.orgLookup) {
    return null;
  }

  const color =
    typeof src.exterior_color_text === "string"
      ? normalizeCanonicalColor(src.exterior_color_text)
      : null;
  const stock =
    typeof src.stock_number_text === "string"
      ? src.stock_number_text.trim() || null
      : null;
  const engine =
    typeof src.engine_size_text === "string"
      ? src.engine_size_text.trim() || null
      : null;
  const row =
    typeof src.row_text === "string" ? src.row_text.trim() || null : null;

  return {
    vin,
    source: "autorecycler",
    year: parts.year,
    make: parts.make,
    model: parts.model,
    color,
    stockNumber: stock,
    imageUrl: normalizeImageUrl(src.preview_image_image),
    availableDate: addedDateToIso(src.added_date_date),
    locationCode: org,
    locationName: orgGeo.locationName,
    locationCity: orgGeo.locationCity,
    state: orgGeo.state,
    stateAbbr: orgGeo.stateAbbr,
    lat: orgGeo.lat,
    lng: orgGeo.lng,
    section: null,
    row,
    space: null,
    partsUrl: null,
    pricesUrl: null,
    engine,
    trim: null,
    transmission: null,
    detailsUrl: `${AUTORECYCLER_ORIGIN}/details/${inventoryId}`,
  };
}
