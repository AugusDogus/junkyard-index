import type { Location } from "~/lib/types";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { CanonicalVehicle } from "./types";

/**
 * PYP Inventory/Filter vehicle JSON shape.
 */
export interface PypVehicleJson {
  YardCode: string;
  Section: string;
  Row: string;
  SpaceNumber: string;
  Color: string;
  Year: string;
  Make: string;
  Model: string;
  InYardDate: string;
  StockNumber: string;
  Vin: string;
  Photos: ReadonlyArray<{
    PhotoPath: string;
    IsPrimary: boolean;
    IsInternal: boolean;
    InventoryPhoto: boolean;
  }>;
}

const PYP_BASE = "https://www.pyp.com";

/** Positions are short provider labels, not descriptions, markup, or URLs. */
function yardPosition(value: string): string | null {
  const label = value.trim();
  if (
    label.length > 40 ||
    !/^[\p{L}\p{N} ./&#'()-]+$/u.test(label) ||
    !/[\p{L}\p{N}]/u.test(label)
  ) {
    return null;
  }
  const placeholder = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  return /^(?:na|none|null|undefined|unknown|tbd|tba|pending|unassigned|notassigned|notavailable|notapplicable|unavailable)$/.test(
    placeholder,
  )
    ? null
    : label;
}

/**
 * Transform a PYP JSON vehicle to our canonical format.
 * Pure function — no side effects or network calls.
 */
export function transformPypVehicle(
  v: PypVehicleJson,
  locationMap: Map<string, Location>,
): CanonicalVehicle | null {
  if (!v.Vin) return null;

  const location = locationMap.get(v.YardCode);
  if (!location) return null;

  // Get primary image URL (first photo, or first non-internal one)
  let imageUrl: string | null = null;
  if (v.Photos && v.Photos.length > 0) {
    const primary = v.Photos.find((p) => p.IsPrimary);
    imageUrl = primary?.PhotoPath ?? v.Photos[0]?.PhotoPath ?? null;
  }

  // Parse available date
  let availableDate: string | null = null;
  if (v.InYardDate) {
    try {
      const d = new Date(v.InYardDate);
      if (!isNaN(d.getTime())) availableDate = d.toISOString();
    } catch {
      // skip
    }
  }

  const year = parseInt(v.Year) || 0;
  const make = normalizeCanonicalMake(v.Make);
  const color = normalizeCanonicalColor(v.Color);

  // Build URLs
  const modelSlug = v.Model.toLowerCase().split(" ").join("-");
  const inventoryPath = location.urls?.inventory ?? `/inventory/`;
  const detailsUrl = `${PYP_BASE}${inventoryPath}${year}-${make.toLowerCase()}-${modelSlug}/`;
  const partsUrl = location.urls?.parts
    ? `${PYP_BASE}${location.urls.parts}?year=${year}&make=${make}&model=${v.Model}`
    : null;
  const pricesUrl = location.urls?.prices
    ? `${PYP_BASE}${location.urls.prices}`
    : null;

  return {
    vin: v.Vin,
    source: "pyp",
    year,
    make,
    model: v.Model,
    color,
    stockNumber: v.StockNumber || null,
    imageUrl,
    availableDate,
    locationCode: v.YardCode,
    locationName: location.name,
    locationCity: location.city,
    state: location.state,
    stateAbbr: location.stateAbbr,
    lat: location.lat,
    lng: location.lng,
    section: yardPosition(v.Section),
    row: yardPosition(v.Row),
    space: yardPosition(v.SpaceNumber),
    detailsUrl,
    partsUrl,
    pricesUrl,
    engine: null,
    trim: null,
    transmission: null,
  };
}
