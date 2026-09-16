import type { IngestionSource } from "~/lib/ingestion-source";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type {
  TapInventorySearchProduct,
  TapInventorySiteConfig,
  TapInventoryStoreConfig,
} from "./tap-inventory-client";
import type { CanonicalVehicle } from "./types";

export type TapCanonicalVehicle<
  Source extends IngestionSource = IngestionSource,
> = Omit<CanonicalVehicle, "source"> & { source: Source };

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImageUrl(rawHtml: string): string | null {
  const match = /<img[^>]+src=["']([^"']+)["']/i.exec(rawHtml);
  const url = match?.[1]?.trim() || null;
  // This is the provider's missing-photo marker, and the URL itself returns 404.
  if (
    url ===
    "https://tearapart.com/inventory-photos/resized-images/coming-soon-150x113.png"
  ) {
    return null;
  }
  return url;
}

export function transformTapInventoryProduct<Source extends IngestionSource>(
  product: TapInventorySearchProduct,
  store: TapInventoryStoreConfig,
  site: TapInventorySiteConfig<Source>,
): TapCanonicalVehicle<Source> | null {
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
  // Tear-A-Part ignores stock and filter query parameters. Its public search is
  // POST-only; do not advertise an unsupported vehicle link. See the runbook.
  const detailsUrl =
    site.source === "tearapart"
      ? null
      : stockNumber.length > 0
        ? `${site.inventoryPageUrl}?stock=${encodeURIComponent(stockNumber)}`
        : site.inventoryPageUrl;

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
    row: product.vehicle_row?.trim() || null,
    space: null,
    detailsUrl,
    // The site exposes a single parts pricing page rather than separate parts/prices routes.
    partsUrl: `${new URL(site.partsPricelistPath, site.inventoryPageUrl).toString()}`,
    pricesUrl: `${new URL(site.partsPricelistPath, site.inventoryPageUrl).toString()}`,
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
