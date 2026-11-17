import type { Yard } from "~/lib/yard";
import { inventoryVin } from "./inventory-vin";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import type { CanonicalVehicle } from "./types";
import {
  VANDERHAAGS_ORIGIN,
  type VanderHaagsDonor,
} from "./vanderhaags-catalog";

// Official Sioux Falls location page and linked map, verified 2026-11-17.
export const VANDERHAAGS_YARD = {
  source: "vanderhaags",
  code: "sioux-falls",
  name: "Vander Haag's Sioux Falls",
  operator: "Vander Haag's",
  address: "1423 E 54th St N",
  city: "Sioux Falls",
  state: "SD",
  postalCode: "57104",
  phone: "888-940-5030",
  email: null,
  lat: 43.594099,
  lng: -96.70945,
  websiteUrl: VANDERHAAGS_ORIGIN + "/locationtemplate.php?store=Sioux%20Falls",
} as const satisfies Yard;

// Published manufacturer labels, longest first. Never guess a make from a VIN.
const makes = [
  "Western Star Trucks",
  "International",
  "Freightliner",
  "Peterbilt",
  "Chevrolet",
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
) {
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
    locationCode: VANDERHAAGS_YARD.code,
    locationName: VANDERHAAGS_YARD.name,
    locationCity: VANDERHAAGS_YARD.city,
    state: "South Dakota",
    stateAbbr: "SD",
    lat: VANDERHAAGS_YARD.lat,
    lng: VANDERHAAGS_YARD.lng,
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
