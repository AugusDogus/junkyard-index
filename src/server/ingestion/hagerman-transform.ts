import type { CanonicalVehicle } from "./types";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { HagermanDonor, HagermanMember } from "./hagerman-parser";
import {
  HagermanYard,
  type HagermanCoordinates,
} from "./hagerman-yard-metadata";

export type HagermanCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "hagerman";
};
export type HagermanAssessment =
  | { status: "accepted"; donor: HagermanDonor; vin: string }
  | {
      status: "rejected";
      donor: HagermanDonor;
      vin: string | null;
      reasons: string[];
    };
const scalar = (value: string) =>
  value.trim() &&
  !/^(?:unknown|other|n\/?a|none|null|0|-)$/i.test(value.trim());

export function assessHagermanDonor(
  member: HagermanMember,
  donor: HagermanDonor,
): HagermanAssessment {
  // Identity is observed independently of optional metadata and required YMM failures.
  const vin = inventoryVin(donor.vin, donor.year);
  const reasons: string[] = [];
  if (!vin) reasons.push("missing-or-invalid-native-identity");
  if (
    !/^\d{4}$/.test(donor.year) ||
    Number(donor.year) < 1886 ||
    Number(donor.year) > 2100 ||
    !scalar(donor.make) ||
    !/[A-Z]/i.test(donor.make) ||
    !scalar(donor.model)
  )
    reasons.push("missing-or-invalid-native-ymm");
  // The actual Sterling detail additionally prefixes its separately published Part Model.
  const detailTitle = `${donor.partModel ? donor.partModel + " " : ""}${donor.make} ${donor.model} ${donor.year} Dismantled Vehicles`;
  if (
    member.year !== donor.year ||
    member.make !== donor.make ||
    member.model !== donor.model ||
    member.title !==
      `${donor.year} ${donor.make} ${donor.model} Dismantled Vehicles` ||
    donor.title !== detailTitle ||
    (member.stock !== null &&
      donor.stock !== null &&
      member.stock !== donor.stock)
  )
    reasons.push("conflicting-opening-and-primary-detail");
  if (donor.owner !== "82891 Bud Draper Rd UMATILLA, OR")
    reasons.push("unverified-native-yard-ownership");
  if (reasons.length || !vin)
    return { status: "rejected", donor, vin, reasons };
  return { status: "accepted", donor, vin };
}

export function transformHagermanDonor(
  record: Extract<HagermanAssessment, { status: "accepted" }>,
  coordinates: HagermanCoordinates,
): HagermanCanonicalVehicle {
  const donor = record.donor,
    yard = HagermanYard.create(coordinates);
  return {
    source: "hagerman",
    vin: record.vin,
    year: Number(donor.year),
    make: normalizeCanonicalMake(donor.make),
    model: donor.model,
    stockNumber: donor.stock && scalar(donor.stock) ? donor.stock : null,
    imageUrl: donor.imageUrl,
    color: null,
    availableDate: null,
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    state: "Oregon",
    stateAbbr: "OR",
    lat: yard.lat,
    lng: yard.lng,
    detailsUrl: donor.url,
    partsUrl: null,
    pricesUrl: null,
    section: null,
    row: null,
    space: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}
