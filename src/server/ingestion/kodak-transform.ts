import { inventoryVin } from "./inventory-vin";
import type { KodakRecord } from "./kodak-parser";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { CanonicalVehicle } from "./types";
import { KODAK_INVENTORY, KODAK_YARD } from "./kodak-yard-metadata";

export type KodakCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "kodak";
};
export type KodakRecordResult =
  | { status: "available"; vehicle: KodakCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };

export function kodakNativeIdentity(record: KodakRecord) {
  const match = /^(\d{4})\s+([A-Za-z]+)\s+(.+)$/.exec(record.title);
  return {
    year: match?.[1] ?? "",
    make: match?.[2] ?? "",
    model: match?.[3] ?? "",
  };
}

export function transformKodakRecord(record: KodakRecord): KodakRecordResult {
  const native = kodakNativeIdentity(record);
  const vin = inventoryVin(record.fields.VIN ?? "", native.year);
  const year = Number(native.year);
  const unusable = (value: string) =>
    !/[a-z0-9]/i.test(value) ||
    /^(?:unknown|other|none|null|n\/?a)$/i.test(value);
  if (
    !vin ||
    !/^\d{4}$/.test(native.year) ||
    year < 1886 ||
    year > 2100 ||
    unusable(native.make) ||
    unusable(native.model)
  )
    return { status: "incomplete", vin };
  const image =
    record.photo === null
      ? null
      : URL.parse(record.photo, "https://kodakauto.co");
  const imageUrl =
    image &&
    image.origin === "https://img1.wsimg.com" &&
    !image.username &&
    !image.password &&
    !image.search &&
    !image.hash &&
    image.pathname.startsWith(
      "/isteam/ip/874ec5a1-37b8-4882-b105-804723817fcf/",
    )
      ? image.href
      : null;
  return {
    status: "available",
    vehicle: {
      source: "kodak",
      vin,
      year,
      make: normalizeCanonicalMake(native.make),
      model: native.model,
      color: normalizeCanonicalColor(record.fields.Color ?? null),
      imageUrl,
      stockNumber: null,
      availableDate: null,
      locationCode: KODAK_YARD.code,
      locationName: KODAK_YARD.name,
      locationCity: KODAK_YARD.city,
      state: "Tennessee",
      stateAbbr: "TN",
      lat: KODAK_YARD.lat,
      lng: KODAK_YARD.lng,
      section: null,
      row: null,
      space: null,
      detailsUrl: KODAK_INVENTORY,
      partsUrl: null,
      pricesUrl: null,
      engine: record.fields.Engine?.trim() || null,
      trim: null,
      transmission: null,
    },
  };
}
