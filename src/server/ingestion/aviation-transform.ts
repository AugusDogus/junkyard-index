import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { CanonicalVehicle } from "./types";
import type { AviationRecord } from "./aviation-parser";
import {
  AVIATION_IMAGE_PREFIX,
  AVIATION_ORIGIN,
  AVIATION_YARD,
} from "./aviation-yard-metadata";

export type AviationCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "aviation";
};
export type AviationRecordResult =
  | { status: "available"; vehicle: AviationCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };
export interface AviationModelContext {
  make: string;
  model: string;
}
const unusable = (raw: string) =>
  !/[A-Z0-9]/i.test(raw) ||
  /^(?:other|unknown|n\/?a|none|null|undefined|[-?]+)$/i.test(raw);

export function aviationDate(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw + "T00:00:00Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? raw
    : null;
}

export function aviationImage(
  raw: string | null,
  stock: string,
): string | null {
  const url =
    raw === null
      ? null
      : URL.parse(raw.includes(":") ? raw : AVIATION_IMAGE_PREFIX + raw);
  const prefix = AVIATION_IMAGE_PREFIX + stock + "/";
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

/** Directory/breadcrumb context supplies the explicit SMART model without
 * decoding a VIN or treating a guessed URL segment as descriptive metadata. */
export function transformAviationRecord(
  record: AviationRecord,
  context: AviationModelContext,
): AviationRecordResult {
  const [rawVin, rawYear, title, stock, destination, image, date] = record;
  const vin = inventoryVin(rawVin, rawYear);
  const year = Number(rawYear);
  const nativeModel = title.startsWith(context.make + " ")
    ? title.slice(context.make.length).trim()
    : title === context.make && context.model === context.make
      ? context.model
      : "";
  const url = URL.parse(
    destination.startsWith("/used-parts/")
      ? AVIATION_ORIGIN + destination
      : destination,
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
    url.origin !== AVIATION_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/used-parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(url.pathname) ||
    tail?.[0] !== stock ||
    tail[1] !== rawYear
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "aviation",
      vin,
      year,
      make: normalizeCanonicalMake(context.make),
      model: nativeModel,
      stockNumber:
        /^[A-Z0-9][A-Z0-9-]{0,39}$/i.test(stock) && !unusable(stock)
          ? stock
          : null,
      imageUrl: aviationImage(image, stock),
      availableDate: aviationDate(date),
      color: null,
      locationCode: AVIATION_YARD.code,
      locationName: AVIATION_YARD.name,
      locationCity: AVIATION_YARD.city,
      state: "Arizona",
      stateAbbr: "AZ",
      lat: AVIATION_YARD.lat,
      lng: AVIATION_YARD.lng,
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
