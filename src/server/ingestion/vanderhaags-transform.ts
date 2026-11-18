import { VANDERHAAGS_YARDS } from "./vanderhaags-yards";
export { VANDERHAAGS_YARD } from "./vanderhaags-yards";
import { inventoryVin } from "./inventory-vin";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";
import type { CanonicalVehicle } from "./types";
import {
  VANDERHAAGS_ORIGIN,
  type VanderHaagsDonor,
} from "./vanderhaags-catalog";

// Published manufacturer labels. Never guess a make from a VIN.
const makes = [
  "Western Star Trucks",
  "International",
  "Freightliner",
  "Peterbilt",
  "Chevrolet",
  "Mitsubishi",
  "Workhorse",
  "Blue Bird",
  "Capacity",
  "Autocar",
  "E-ONE",
  "UD",
  "Kenworth",
  "Sterling",
  "Ottawa",
  "Volvo",
  "Isuzu",
  "Ford",
  "Mack",
  "Hino",
  "GMC",
  "Cat",
];

export function transformVanderHaagsDonor(
  donor: VanderHaagsDonor,
  fields: ReadonlyMap<string, string>,
  availability: "available" | "unavailable",
) {
  const yard = VANDERHAAGS_YARDS.find(
    (y) => y.catalogLabel === donor.yard,
  )?.yard;
  const yearText = donor.title.slice(0, 4);
  const year = Number(yearText);
  const rawVin = fields.get("VIN:") ?? "";
  const vin = inventoryVinWithCheckDigit(rawVin, yearText);
  const description = (fields.get("Vehicle Info:") ?? "").slice(5);
  const makeLabel = makes.find((make) => description.startsWith(make + " "));
  const model = makeLabel ? description.slice(makeLabel.length + 1).trim() : "";
  const make = normalizeCanonicalMake(
    makeLabel === "Western Star Trucks" ? "Western Star" : (makeLabel ?? ""),
  );
  if (
    availability !== "available" ||
    !yard ||
    !vin ||
    fields.get("Vehicle Info:")?.toUpperCase() !==
      donor.title.split(" Parts Unit:")[0]?.toUpperCase() ||
    !make ||
    !model ||
    /^(?:unknown|other|n\/?a)$/i.test(model) ||
    year < 1886 ||
    year > 2100
  )
    return { status: "rejected", vin: inventoryVin(rawVin, yearText) } as const;
  const vehicle: CanonicalVehicle = {
    source: "vanderhaags",
    vin,
    year,
    make,
    model,
    color: normalizeCanonicalColor(fields.get("Color:") ?? ""),
    stockNumber: donor.stock,
    imageUrl: donor.image,
    availableDate: null,
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    state: normalizeRegion(yard.state).state,
    stateAbbr: yard.state,
    lat: yard.lat,
    lng: yard.lng,
    section: null,
    row: null,
    space: null,
    detailsUrl: VANDERHAAGS_ORIGIN + donor.path,
    partsUrl: null,
    pricesUrl: null,
    engine: fields.get("Engine:") || null,
    trim: null,
    transmission: fields.get("Transmission:") || null,
  };
  return { status: "available", vehicle } as const;
}
