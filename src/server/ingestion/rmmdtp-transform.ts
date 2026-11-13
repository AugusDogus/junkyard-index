import type { CanonicalVehicle } from "./types";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { RmmdtpContract } from "./rmmdtp-contract";
import { rmmdtpDetailUrl } from "./rmmdtp-html";
import type { RmmdtpRecord } from "./rmmdtp-record";

export type RmmdtpCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "rmmdtp";
};
export const rmmdtpClaimKey = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
const missing = (value: string) =>
  /^(?:|other|unknown|none|null|undefined|na|notavailable|0+)$/.test(
    value.toLowerCase().replace(/[\s/_.-]+/g, ""),
  ) || !/[A-Z0-9]/i.test(value);
export function rmmdtpPhotoUrl(raw: string | null): string | null {
  const url = raw === null ? null : URL.parse(raw);
  return url &&
    url.href === raw &&
    raw !== null &&
    raw.length <= 4096 &&
    url.origin === "https://images.truckpartsinventory.com" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/trucks\/372\/[a-z0-9][a-z0-9._()-]*\.(?:jpe?g|png|webp)$/i.test(
      url.pathname,
    ) &&
    !/(?:placeholder|loading|no[-_]?image)/i.test(url.pathname)
    ? url.href
    : null;
}
export function assessRmmdtpRecord(record: RmmdtpRecord) {
  const yearText = /^(\d{4})\s/.exec(record.title)?.[1] ?? "";
  const year = Number(yearText),
    makeText = record.fields["Truck Make"] ?? "",
    model = (record.fields["Truck Model"] ?? "").trim();
  const make = normalizeCanonicalMake(makeText),
    vin = inventoryVin(record.fields["Vin Number"] ?? "", yearText);
  const reasons: string[] = [];
  if (
    !yearText ||
    !Number.isInteger(year) ||
    year < 1886 ||
    year > 2100 ||
    missing(make) ||
    !/[A-Z]/i.test(make) ||
    missing(model)
  )
    reasons.push("missing-required-native-ymm");
  if (vin === null) reasons.push("missing-or-invalid-native-vin");
  if (
    rmmdtpClaimKey(record.title) !==
    rmmdtpClaimKey(`${yearText} ${makeText} ${model}`)
  )
    reasons.push("conflicting-native-title-ymm");
  if (
    rmmdtpDetailUrl(record.detailsUrl) !== record.detailsUrl ||
    new URL(record.detailsUrl).searchParams.get("truck") !== record.id ||
    record.detailAnchors.some((url) => url !== record.detailsUrl)
  )
    reasons.push("conflicting-native-destination");
  const condition = record.fields.Condition;
  if (condition !== "Salvage" && condition !== "Complete")
    reasons.push("unresolved-native-condition");
  // Description remains a source claim. It never silently replaces structured
  // make/model, including Other/Other with the explicit 2015 KIA SORENTO prose.
  return { record, year, make, model, vin, condition, reasons };
}
export function transformRmmdtpRecord(
  record: RmmdtpRecord,
  contract: RmmdtpContract,
): RmmdtpCanonicalVehicle | null {
  const row = assessRmmdtpRecord(record);
  if (row.reasons.length || row.condition !== "Salvage" || row.vin === null)
    return null;
  const yard = contract.yard,
    stock = record.fields["Lot Number"] ?? "",
    engine = record.fields["Engine Model"] ?? "";
  return {
    source: "rmmdtp",
    vin: row.vin,
    year: row.year,
    make: row.make,
    model: row.model,
    stockNumber:
      !missing(stock) && /^[A-Z0-9][A-Z0-9 ./-]{0,49}$/i.test(stock)
        ? stock
        : null,
    imageUrl: rmmdtpPhotoUrl(record.imageUrl),
    detailsUrl: record.detailsUrl,
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    state: "Utah",
    stateAbbr: "UT",
    lat: yard.lat,
    lng: yard.lng,
    color: null,
    availableDate: null,
    section: null,
    row: null,
    space: null,
    partsUrl: null,
    pricesUrl: null,
    engine: engine.length <= 500 && !missing(engine) ? engine : null,
    trim: null,
    transmission: null,
  };
}
