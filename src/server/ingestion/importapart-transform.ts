import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { ImportapartRecord } from "./importapart-parser";
import { importapartTitleKey } from "./importapart-parser";
import { IMPORTAPART_YARD } from "./importapart-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type ImportapartCanonicalVehicle = CanonicalVehicle & {
  source: "importapart";
};
export type ImportapartVehicleResult =
  | { status: "available"; vehicle: ImportapartCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };

const makePattern =
  /\b(Mercedes[ -]Benz|Land Rover|Alfa Romeo|Aston Martin|Acura|AMC|Audi|BMW|Buick|Cadillac|Chevrolet|Chrysler|Dodge|Fiat|Ford|Genesis|Geo|GMC|Honda|Hummer|Hyundai|Infiniti|Isuzu|Jaguar|Jeep|Kia|Lexus|Lincoln|Maserati|Mazda|Mercury|Mini|Mitsubishi|Nissan|Oldsmobile|Plymouth|Pontiac|Porsche|Ram|Saab|Saturn|Scion|Subaru|Suzuki|Tesla|Toyota|Volkswagen|Volvo)\b/i;
const missing = (value: string) =>
  !/[A-Z0-9]/i.test(value) ||
  /^(?:other|unknown|none|null|na|0+)$/.test(
    value.toLowerCase().replace(/[\s/_.-]+/g, ""),
  );

function modelFamily(raw: string, make: string): string {
  const tokens = raw
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Z0-9]/gi, "").toLowerCase())
    .filter(
      (token) => token && !(make === "BMW" && /^[efg]\d{2}$/.test(token)),
    );
  const first = tokens[0] ?? "";
  // Native titles vary their trim and chassis detail. Compare the published
  // base model, including common two-word names, without decoding the VIN.
  return ["grand", "land", "town"].includes(first)
    ? tokens.slice(0, 2).join(" ")
    : first;
}

export function importapartRecordVin(record: ImportapartRecord): string | null {
  return inventoryVin(record.vin, /^(\d{4})\b/.exec(record.title)?.[1] ?? "");
}
export function transformImportapartRecord(
  record: ImportapartRecord,
): ImportapartVehicleResult {
  const yearText = /^(\d{4})\b/.exec(record.title)?.[1] ?? "";
  const year = Number(yearText);
  const vin = importapartRecordVin(record);
  const specificHeaderYear = /^(\d{4})\b/.exec(record.header)?.[1];
  const range = /^(\d{2})-(\d{2})\b/.exec(record.header);
  const firstYear = Number(range?.[1]);
  const lastYear = Number(range?.[2]);
  const shortYear = year % 100;
  const rangeHeader =
    range !== null &&
    (firstYear <= lastYear
      ? shortYear >= firstYear && shortYear <= lastYear
      : shortYear >= firstYear || shortYear <= lastYear);
  const makeMatch = makePattern.exec(record.header);
  const make = makeMatch ? normalizeCanonicalMake(makeMatch[1] ?? "") : "";
  const model = makeMatch
    ? record.header
        .slice(makeMatch.index + makeMatch[0].length)
        .replace(/\s*-?\s*part\s*out\s*$/i, "")
        .trim()
    : "";
  const titleMakeMatch = makePattern.exec(record.title);
  const titleMake = titleMakeMatch?.[1];
  const titleModel = titleMakeMatch
    ? record.title.slice(titleMakeMatch.index + titleMakeMatch[0].length)
    : record.title.replace(/^\d{4}\s+/, "");
  if (
    !vin ||
    !yearText ||
    year < 1886 ||
    year > 2100 ||
    importapartTitleKey(record.title) !==
      importapartTitleKey(record.post.title) ||
    (!specificHeaderYear && !rangeHeader) ||
    (specificHeaderYear !== undefined && specificHeaderYear !== yearText) ||
    !make ||
    missing(make) ||
    missing(model) ||
    modelFamily(titleModel, make) !== modelFamily(model, make) ||
    (titleMake !== undefined && normalizeCanonicalMake(titleMake) !== make)
  )
    return { status: "incomplete", vin };
  const stock = record.stock.trim();
  return {
    status: "available",
    vehicle: {
      source: "importapart",
      vin,
      year,
      make,
      model,
      stockNumber:
        /^[A-Z0-9][A-Z0-9-]{1,39}$/i.test(stock) && !missing(stock)
          ? stock
          : null,
      color: null,
      imageUrl: null,
      availableDate: null,
      locationCode: IMPORTAPART_YARD.code,
      locationName: IMPORTAPART_YARD.name,
      locationCity: IMPORTAPART_YARD.city,
      state: "Missouri",
      stateAbbr: "MO",
      lat: IMPORTAPART_YARD.lat,
      lng: IMPORTAPART_YARD.lng,
      section: null,
      row: null,
      space: null,
      detailsUrl: record.post.url,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
