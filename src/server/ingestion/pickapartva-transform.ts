import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { PickapartvaRecord } from "./pickapartva-parser";
import {
  PICKAPARTVA_ORIGIN,
  PICKAPARTVA_YARDS,
  type PickapartvaSearchScope,
  type PickapartvaYardCode,
} from "./pickapartva-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type PickapartvaCanonicalVehicle = CanonicalVehicle & {
  source: "pickapartva";
};
export type PickapartvaVehicleResult =
  | { status: "available"; vehicle: PickapartvaCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };

const usable = (raw: string) =>
  raw.length <= 100 &&
  /[a-z0-9]/i.test(raw) &&
  !/^(?:other|unknown|none|null|undefined|n\/?a|0+)$/i.test(raw.trim());
export function pickapartvaStock(raw: string): string | null {
  return /^(?:PAP|STK)\d{6}$/.test(raw) ? raw : null;
}
export function pickapartvaImageUrl(
  raw: string | null,
  code: PickapartvaYardCode,
  stock: string | null,
): string | null {
  const url = raw === null ? null : URL.parse(raw);
  return stock !== null &&
    url?.origin === "https://da8h1v3w8q6n5.cloudfront.net" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.pathname.startsWith(
      `/${code.toLowerCase()}/images/${stock}/${stock}-`,
    ) &&
    /\.(?:jpg|jpeg|png)$/i.test(url.pathname)
    ? url.href
    : null;
}
function date(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const value = new Date(raw + "T00:00:00.000Z");
  return Number.isFinite(value.getTime()) &&
    value.getUTCFullYear() >= 1886 &&
    value.getUTCFullYear() <= 2100 &&
    value.toISOString().slice(0, 10) === raw
    ? value.toISOString()
    : null;
}

/** Where the donor card was listed: a catalog page number, or the set-date
 * search (across every yard or within one) that recovered a donor the catalog
 * pages hid. */
export type PickapartvaListing =
  | number
  | { search: string; id: PickapartvaSearchScope };

export function transformPickapartvaRecord(
  record: PickapartvaRecord,
  listing: PickapartvaListing,
): PickapartvaVehicleResult {
  const vin = inventoryVin(record.vin, record.year);
  const year = /^\d{4}$/.test(record.year) ? Number(record.year) : NaN;
  const make = normalizeCanonicalMake(record.make);
  const model = record.model.trim();
  if (
    vin === null ||
    !Number.isInteger(year) ||
    year < 1886 ||
    year > 2100 ||
    !usable(make) ||
    !usable(model)
  )
    return { status: "incomplete", vin };
  const yard = PICKAPARTVA_YARDS[record.yardCode];
  const stockNumber = pickapartvaStock(record.stock);
  return {
    status: "available",
    vehicle: {
      source: "pickapartva",
      vin,
      year,
      make,
      model,
      color: null,
      stockNumber,
      imageUrl: pickapartvaImageUrl(
        record.imageUrl,
        record.yardCode,
        stockNumber,
      ),
      availableDate: date(record.setDate),
      locationCode: yard.code,
      locationName: yard.name,
      locationCity: yard.city,
      state: "Virginia",
      stateAbbr: "VA",
      lat: yard.lat,
      lng: yard.lng,
      section: null,
      row:
        usable(record.row) && /^[A-Z0-9][A-Z0-9 -]{0,39}$/i.test(record.row)
          ? record.row
          : null,
      space: null,
      detailsUrl:
        `${PICKAPARTVA_ORIGIN}/inventory/ANY/ANY/?k=1&` +
        (typeof listing === "number"
          ? `id=ANY&pagenum=${listing}`
          : `id=${listing.id}&search=${encodeURIComponent(listing.search)}`) +
        (record.cardId ? "#" + encodeURIComponent(record.cardId) : ""),
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}

/** Required identity conflicts abort. Optional disagreements stay unknown. */
export function mergePickapartvaVehicles(
  first: PickapartvaCanonicalVehicle,
  next: PickapartvaCanonicalVehicle,
): PickapartvaCanonicalVehicle {
  if (
    first.vin !== next.vin ||
    first.year !== next.year ||
    first.make.toUpperCase() !== next.make.toUpperCase() ||
    first.model.toUpperCase() !== next.model.toUpperCase() ||
    first.locationCode !== next.locationCode
  )
    throw new Error(
      "Pick-A-Part VA repeated VIN has conflicting required identity or physical yard: " +
        first.vin,
    );
  return {
    ...first,
    stockNumber:
      first.stockNumber === next.stockNumber ? first.stockNumber : null,
    imageUrl: first.imageUrl === next.imageUrl ? first.imageUrl : null,
    availableDate:
      first.availableDate === next.availableDate ? first.availableDate : null,
    row: first.row === next.row ? first.row : null,
    // The original saved ANY control and unfiltered form establish this common
    // destination when different stock fragments/pages describe the same VIN.
    detailsUrl:
      first.stockNumber === next.stockNumber
        ? first.detailsUrl
        : `${PICKAPARTVA_ORIGIN}/inventory/ANY/ANY/?k=1&id=ANY`,
  };
}
