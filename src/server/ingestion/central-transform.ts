import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { CanonicalVehicle } from "./types";
import type { CentralRecord } from "./central-parser";
import {
  CENTRAL_IMAGE_PREFIX,
  CENTRAL_ORIGIN,
  CENTRAL_YARD,
} from "./central-yard-metadata";

export type CentralCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "central";
};
export type CentralRecordResult =
  | { status: "available"; vehicle: CentralCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };
export interface CentralModelContext {
  make: string;
  model: string;
  makePath: string;
}
const unusable = (raw: string) =>
  !/[A-Z0-9]/i.test(raw) ||
  /^(?:other|unknown|n\/?a|none|null|undefined|[-?]+)$/i.test(raw);
const usableStock = (raw: string) =>
  raw.length > 0 &&
  raw.length <= 100 &&
  !unusable(raw) &&
  !/[/?#]/.test(raw) &&
  [...raw].every(
    (character) =>
      character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
  );

export function centralImage(raw: string | null, stock: string): string | null {
  const url =
    raw === null
      ? null
      : URL.parse(raw.includes(":") ? raw : CENTRAL_IMAGE_PREFIX + raw);
  const prefix = CENTRAL_IMAGE_PREFIX + stock + "/";
  return url &&
    usableStock(stock) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.href.startsWith(prefix) &&
    /^\d+\.(?:jpe?g|png|webp)$/i.test(
      (url.pathname.split("/").at(-1) ?? "").slice(stock.length + 1),
    ) &&
    (url.pathname.split("/").at(-1) ?? "").startsWith(stock + "_")
    ? url.href
    : null;
}

/** The explicit native menu make delimits the supplied card title. Route tokens
 * never repair identity. A make-as-model needs its real published model control. */
export function centralNativeIdentity(
  record: CentralRecord,
  context: CentralModelContext,
): { make: string; model: string } {
  const title = record[2];
  const allowed = [context.model, context.make + " " + context.model];
  if (!allowed.includes(title)) return { make: "", model: "" };
  if (context.make && title.startsWith(context.make + " "))
    return {
      make: context.make,
      model: title.slice(context.make.length).trim(),
    };
  if (title && title === context.make && context.model === context.make)
    return { make: context.make, model: context.model };
  return { make: "", model: "" };
}

export function transformCentralRecord(
  record: CentralRecord,
  context: CentralModelContext,
): CentralRecordResult {
  const [rawVin, rawYear, , stock, destination, image] = record;
  const suppliedStock = usableStock(stock) ? stock : null;
  const vin = inventoryVin(rawVin, rawYear);
  const year = Number(rawYear);
  const native = centralNativeIdentity(record, context);
  const url = URL.parse(
    destination.startsWith("/used-parts/")
      ? CENTRAL_ORIGIN + destination
      : destination,
  );
  const tail = url?.pathname.split("/").slice(-2);
  const stockNumber = suppliedStock === tail?.[0] ? suppliedStock : null;
  if (
    !vin ||
    !/^\d{4}$/.test(rawYear) ||
    year < 1886 ||
    year > 2100 ||
    unusable(native.make) ||
    unusable(native.model) ||
    !url ||
    url.origin !== CENTRAL_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(context.makePath.replace(/\/$/, "") + "/") ||
    !/^\/used-parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(url.pathname) ||
    tail?.[1] !== rawYear
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "central",
      vin,
      year,
      make: normalizeCanonicalMake(native.make),
      model: native.model,
      stockNumber,
      imageUrl: stockNumber === null ? null : centralImage(image, stockNumber),
      availableDate: null,
      color: null,
      locationCode: CENTRAL_YARD.code,
      locationName: CENTRAL_YARD.name,
      locationCity: CENTRAL_YARD.city,
      state: "New Jersey",
      stateAbbr: "NJ",
      lat: CENTRAL_YARD.lat,
      lng: CENTRAL_YARD.lng,
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
