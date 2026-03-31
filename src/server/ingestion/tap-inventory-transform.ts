import { normalizeCanonicalColor, normalizeCanonicalMake } from "./normalization";
import type {
  TapInventoryProduct,
  TapInventorySiteConfig,
  TapInventoryStoreConfig,
} from "./tap-inventory-client";
import type { CanonicalVehicle } from "./types";

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractImageUrl(rawHtml: string): string | null {
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(rawHtml);
  return match?.[1]?.trim() || null;
}

export function transformTapInventoryProduct(
  product: TapInventoryProduct,
  store: TapInventoryStoreConfig,
  site: TapInventorySiteConfig,
): CanonicalVehicle | null {
  const vin = product.vin.trim();
  if (!vin) return null;

  const parsedYear = Number.parseInt(product.iyear, 10);
  if (!Number.isFinite(parsedYear) || parsedYear <= 0) {
    return null;
  }

  const make = normalizeCanonicalMake(product.make);
  const model = product.model.trim();
  if (!model) return null;

  const stockNumber = product.stocknumber.trim();
  const imageUrl = extractImageUrl(product.image_url);
  const detailsUrl =
    stockNumber.length > 0
      ? `${site.baseUrl}/search-inventory/?stock=${encodeURIComponent(stockNumber)}`
      : `${site.baseUrl}/search-inventory/`;

  return {
    vin,
    source: site.source,
    year: parsedYear,
    make,
    model,
    color: normalizeCanonicalColor(product.color),
    stockNumber: stockNumber || null,
    imageUrl,
    availableDate: product.yard_in_date?.trim() || null,
    locationCode: store.code,
    locationName: store.locationName,
    locationCity: store.city,
    state: store.state,
    stateAbbr: store.stateAbbr,
    lat: store.lat,
    lng: store.lng,
    section: null,
    row: product.vehicle_row.trim() || null,
    space: null,
    detailsUrl,
    partsUrl: `${site.baseUrl}/parts-pricelist/`,
    pricesUrl: `${site.baseUrl}/parts-pricelist/`,
    engine: null,
    trim: null,
    transmission: null,
  };
}

export function parseTapInventoryCount(messageHtml: string): number | null {
  const text = stripHtml(messageHtml);
  const match = /\b([\d,]+)\b\s*-\s*result\(s\)\s*found/i.exec(text);
  if (!match?.[1]) return null;
  const parsed = Number.parseInt(match[1].replaceAll(",", ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}
