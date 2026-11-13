import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { CanonicalVehicle } from "./types";
import type { AplusRecord } from "./aplus-parser";
import {
  APLUS_IMAGE_PREFIX,
  APLUS_ORIGIN,
  APLUS_YARD,
} from "./aplus-yard-metadata";

export type AplusCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "aplus";
};
export type AplusRecordResult =
  | { status: "available"; vehicle: AplusCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };
export interface AplusModelContext {
  make: string;
  model: string;
}
const unusable = (raw: string) =>
  !/[A-Z0-9]/i.test(raw) ||
  /^(?:other|unknown|n\/?a|none|null|undefined|[-?]+)$/i.test(raw);

export function aplusDate(raw: string | null): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw + "T00:00:00Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === raw
    ? raw
    : null;
}

export function aplusImage(raw: string | null, stock: string): string | null {
  const url =
    raw === null
      ? null
      : URL.parse(raw.includes(":") ? raw : APLUS_IMAGE_PREFIX + raw);
  const prefix = APLUS_IMAGE_PREFIX + stock + "/";
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

/** The provider's published formatPartURL function is used only to delimit an
 * already supplied complete native label. It never fills missing YMM fields. */
const nativeRouteLabel = (token: string) =>
  token
    .replace(/_/gi, " ")
    .replace(/\+/gi, ",")
    .replace(/\./gi, "/")
    .replace(/~/gi, "-")
    .replace(/and_/gi, "&");

export function aplusNativeIdentity(
  record: AplusRecord,
  context: AplusModelContext,
): { make: string; model: string } {
  const title = record[2];
  if (context.make && title.startsWith(context.make + " "))
    return {
      make: context.make,
      model: title.slice(context.make.length).trim(),
    };
  if (title && title === context.make && context.model === context.make)
    return { make: context.make, model: context.model };
  const url = URL.parse(record[4], APLUS_ORIGIN);
  const segments = url?.pathname.split("/");
  const make = nativeRouteLabel(segments?.[2] ?? "");
  const model = nativeRouteLabel(segments?.[3] ?? "");
  // Arrival make aliases can be absent from the published make menu. Match the
  // entire label before accepting either plain or repeated-make model wording.
  if (
    make &&
    model &&
    (title === make + " " + model ||
      (model.startsWith(make + " ") && title === model))
  )
    return { make, model: title.slice(make.length).trim() };
  return { make: "", model: "" };
}

export function transformAplusRecord(
  record: AplusRecord,
  context: AplusModelContext,
): AplusRecordResult {
  const [rawVin, rawYear, , stock, destination, image, date] = record;
  const suppliedStock =
    /^[A-Z0-9][A-Z0-9-]{0,39}$/i.test(stock) && !unusable(stock) ? stock : null;
  const vin = inventoryVin(rawVin, rawYear);
  const year = Number(rawYear);
  const native = aplusNativeIdentity(record, context);
  const url = URL.parse(
    destination.startsWith("/parts/")
      ? APLUS_ORIGIN + destination
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
    url.origin !== APLUS_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(url.pathname) ||
    tail?.[1] !== rawYear
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "aplus",
      vin,
      year,
      make: normalizeCanonicalMake(native.make),
      model: native.model,
      stockNumber,
      imageUrl: stockNumber === null ? null : aplusImage(image, stockNumber),
      availableDate: aplusDate(date),
      color: null,
      locationCode: APLUS_YARD.code,
      locationName: APLUS_YARD.name,
      locationCity: APLUS_YARD.city,
      state: "Kentucky",
      stateAbbr: "KY",
      lat: APLUS_YARD.lat,
      lng: APLUS_YARD.lng,
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
