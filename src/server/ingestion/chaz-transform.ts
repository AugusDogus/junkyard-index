import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { CanonicalVehicle } from "./types";
import type { ChazRecord } from "./chaz-parser";
import {
  CHAZ_IMAGE_PREFIX,
  CHAZ_ORIGIN,
  CHAZ_YARD,
} from "./chaz-yard-metadata";

export type ChazCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "chaz";
};
export type ChazRecordResult =
  | { status: "available"; vehicle: ChazCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };
export interface ChazModelContext {
  make: string;
  model: string;
}
const unusable = (raw: string) =>
  !/[A-Z0-9]/i.test(raw) ||
  /^(?:other|unknown|n\/?a|none|null|undefined|[-?]+)$/i.test(raw);

export function chazDate(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw + "T00:00:00Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? raw
    : null;
}

export function chazImage(raw: string | null, stock: string): string | null {
  const url =
    raw === null
      ? null
      : URL.parse(raw.includes(":") ? raw : CHAZ_IMAGE_PREFIX + raw);
  const prefix = CHAZ_IMAGE_PREFIX + stock + "/";
  return url &&
    /^[A-Z0-9-]{1,40}$/i.test(stock) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.href.startsWith(prefix) &&
    new RegExp("^" + stock + "_\\d+\\.(?:jpe?g|png|webp)$", "i").test(
      url.pathname.split("/").at(-1) ?? "",
    )
    ? url.href
    : null;
}

/** Split the native label using its published make, preserving display variants. */
export function transformChazRecord(
  record: ChazRecord,
  context: ChazModelContext,
): ChazRecordResult {
  const [rawVin, rawYear, title, stock, destination, image, date] = record;
  const stockNumber =
    /^[A-Z0-9][A-Z0-9-]{0,39}$/i.test(stock) && !unusable(stock) ? stock : null;
  const vin = inventoryVin(rawVin, rawYear);
  const year = Number(rawYear);
  const nativeModel = title.startsWith(context.make + " ")
    ? title.slice(context.make.length).trim()
    : title === context.make && context.model === context.make
      ? context.model
      : "";
  const url = URL.parse(
    destination.startsWith("/parts/") ? CHAZ_ORIGIN + destination : destination,
  );
  const tail = url?.pathname.split("/").slice(-2);
  if (
    !vin ||
    !/^\d{4}$/.test(rawYear) ||
    year < 1886 ||
    year > 2100 ||
    unusable(context.make) ||
    unusable(nativeModel) ||
    !url ||
    url.origin !== CHAZ_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(url.pathname) ||
    (stockNumber !== null && tail?.[0] !== stockNumber) ||
    tail?.[1] !== rawYear
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "chaz",
      vin,
      year,
      make: normalizeCanonicalMake(context.make),
      model: nativeModel,
      stockNumber,
      imageUrl: chazImage(image, stock),
      availableDate: chazDate(date),
      color: null,
      locationCode: CHAZ_YARD.code,
      locationName: CHAZ_YARD.name,
      locationCity: CHAZ_YARD.city,
      state: "Maryland",
      stateAbbr: "MD",
      lat: CHAZ_YARD.lat,
      lng: CHAZ_YARD.lng,
      detailsUrl: url.href,
      partsUrl: null,
      pricesUrl: null,
      section: null,
      row: null,
      space: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
