import { DonorPhoto } from "./donor-photo";
import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { utpapPhotoUrl, type UtpapRecord } from "./utpap-parser";
import type { CanonicalVehicle } from "./types";
import {
  UTPAP_ORIGIN,
  UTPAP_YARDS,
  utpapMakePath,
  type UtpapYardCode,
} from "./utpap-yard-metadata";

export type UtpapCanonicalVehicle = CanonicalVehicle & { source: "utpap" };
export type UtpapDonor = {
  vin: string;
  year: number;
  make: string;
  nativeMake: string;
  model: string;
  color: string | null;
  stockNumber: string;
  row: string | null;
  availableDate: string | null;
  photoUrl: string | null;
};
export type UtpapDonorResult =
  | { status: "available"; donor: UtpapDonor }
  | { status: "incomplete"; vin: string | null };

const colors = new Set([
  "White",
  "Black",
  "Silver",
  "Red",
  "Gray",
  "Blue",
  "Tan",
  "Green",
  "Gold",
  "Maroon",
  "Brown",
  "Bronze",
  "Charcoal",
  "Orange",
  "Burgundy",
  "Yellow",
  "Purple",
  "Champagne",
  "Teal",
]);

/** Preserve the provider's calendar date without inventing a timezone offset. */
function sourceDate(raw: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?$/.exec(raw);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  )
    return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1886 &&
    year <= 2100 &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date.toISOString()
    : null;
}

export function parseUtpapDonor(
  record: UtpapRecord,
  photoUrl: string | null,
  code: UtpapYardCode,
): UtpapDonorResult {
  const vin = inventoryVin(record.VIN, record.iYEAR);
  const year = /^\d{4}$/.test(record.iYEAR) ? Number(record.iYEAR) : NaN;
  const make = normalizeCanonicalMake(record.MAKE);
  const model = record.MODEL.trim();
  const color = normalizeCanonicalColor(record.COLOR);
  const availableDate = sourceDate(record.YARD_DATE);
  const stock = record.STOCKNUMBER;
  const expectedPrefix = code === "1064" ? "A" : "K";
  if (
    !vin ||
    !Number.isInteger(year) ||
    year < 1886 ||
    year > 2100 ||
    !make ||
    /^(?:unknown|other|n\/?a|ATV \/ MOTORCYCLE)$/i.test(record.MAKE) ||
    !model ||
    /^(?:unknown|other|n\/?a)$/i.test(model) ||
    !new RegExp("^" + expectedPrefix + "\\d{6}$").test(stock) ||
    record.S3CLIENTID !== code
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    donor: {
      vin,
      year,
      make,
      nativeMake: record.MAKE,
      model,
      color: color && colors.has(color) ? color : null,
      stockNumber: stock,
      row: /^[1-9]\d*$/.test(record.VEHICLE_ROW) ? record.VEHICLE_ROW : null,
      availableDate,
      photoUrl: utpapPhotoUrl(photoUrl, code, stock),
    },
  };
}

export function utpapPhotoOrigin(raw: string): string {
  const url = URL.parse(raw);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Utah photo delivery requires an HTTPS application origin without credentials, path or query",
    );
  return url.origin;
}

export function transformUtpapDonor(
  donor: UtpapDonor,
  code: UtpapYardCode,
  photoHash: string | null,
  appOrigin: string,
): UtpapCanonicalVehicle {
  if (
    donor.photoUrl === null
      ? photoHash !== null
      : photoHash === null || !DonorPhoto.validHash(photoHash)
  )
    throw new Error("Utah donor photo has no preserved content hash");
  const yard = UTPAP_YARDS[code];
  return {
    source: "utpap",
    vin: donor.vin,
    year: donor.year,
    make: donor.make,
    model: donor.model,
    color: donor.color,
    stockNumber: donor.stockNumber,
    row: donor.row,
    availableDate: donor.availableDate,
    imageUrl:
      photoHash === null
        ? null
        : utpapPhotoOrigin(appOrigin) + "/api/inventory-photos/" + photoHash,
    detailsUrl: UTPAP_ORIGIN + utpapMakePath(code, donor.nativeMake),
    locationCode: code,
    locationName: yard.name,
    locationCity: yard.city,
    state: "Utah",
    stateAbbr: "UT",
    lat: yard.lat,
    lng: yard.lng,
    section: null,
    space: null,
    partsUrl: null,
    pricesUrl: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}
