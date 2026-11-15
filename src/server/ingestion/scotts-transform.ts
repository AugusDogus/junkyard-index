import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { CanonicalVehicle } from "./types";
import type { ScottsRecord } from "./scotts-parser";
import {
  SCOTTS_IMAGE_PREFIX,
  SCOTTS_ORIGIN,
  SCOTTS_YARD,
} from "./scotts-yard-metadata";

export type ScottsCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "scotts";
};
export type ScottsRecordResult =
  | { status: "available"; vehicle: ScottsCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };
export interface ScottsModelContext {
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

export function scottsImage(
  raw: string | null,
  donorId: string,
): string | null {
  const url =
    raw === null
      ? null
      : URL.parse(raw.includes(":") ? raw : SCOTTS_IMAGE_PREFIX + raw);
  const prefix = SCOTTS_IMAGE_PREFIX + donorId + "/";
  return url &&
    usableStock(donorId) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.href.startsWith(prefix) &&
    /^\d+\.(?:jpe?g|png|webp)$/i.test(
      (url.pathname.split("/").at(-1) ?? "").slice(donorId.length + 1),
    ) &&
    (url.pathname.split("/").at(-1) ?? "").startsWith(donorId + "_")
    ? url.href
    : null;
}

/** The explicit native menu make delimits the supplied card title. Route tokens
 * never repair identity. A make-as-model needs its real published model control. */
export function scottsNativeIdentity(
  record: ScottsRecord,
  context: ScottsModelContext,
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

export function transformScottsRecord(
  record: ScottsRecord,
  context: ScottsModelContext,
): ScottsRecordResult {
  const [rawVin, rawYear, , stock, destination, image, cardId] = record;
  const suppliedStock = usableStock(stock) ? stock : null;
  const vin = inventoryVin(rawVin, rawYear);
  const year = Number(rawYear);
  const native = scottsNativeIdentity(record, context);
  const url = URL.parse(
    destination.startsWith("/used-parts/")
      ? SCOTTS_ORIGIN + destination
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
    url.origin !== SCOTTS_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(context.makePath.replace(/\/$/, "") + "/") ||
    !/^\/used-parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(url.pathname) ||
    !cardId ||
    tail?.[0] !== cardId ||
    tail?.[1] !== rawYear
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "scotts",
      vin,
      year,
      make: normalizeCanonicalMake(native.make),
      model: native.model,
      stockNumber,
      imageUrl: scottsImage(image, cardId),
      availableDate: null,
      color: null,
      locationCode: SCOTTS_YARD.code,
      locationName: SCOTTS_YARD.name,
      locationCity: SCOTTS_YARD.city,
      state: "Colorado",
      stateAbbr: "CO",
      lat: SCOTTS_YARD.lat,
      lng: SCOTTS_YARD.lng,
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
