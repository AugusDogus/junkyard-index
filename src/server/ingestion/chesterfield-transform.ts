import { CHESTERFIELD_INVENTORY_URL } from "./chesterfield-client";
import type { ChesterfieldDonor } from "./chesterfield-donor";
import { DonorPhoto } from "./donor-photo";
import { CHESTERFIELD_YARDS } from "./chesterfield-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type ChesterfieldCanonicalVehicle = CanonicalVehicle & {
  source: "chesterfield";
};

export function chesterfieldPhotoOrigin(raw: string): string {
  const url = URL.parse(raw);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Chesterfield photo delivery requires an HTTPS application origin without credentials, path or query",
    );
  return url.origin;
}

export function transformChesterfieldDonor(
  donor: ChesterfieldDonor,
  photoHash: string | null,
  appOrigin: string,
): ChesterfieldCanonicalVehicle {
  if (
    (donor.photoUrl === null) !== (photoHash === null) ||
    (photoHash !== null && !DonorPhoto.validHash(photoHash))
  )
    throw new Error("Chesterfield donor photo has no preserved content hash");
  const yard = CHESTERFIELD_YARDS[donor.yard];
  return {
    source: "chesterfield",
    vin: donor.vin,
    year: donor.year,
    make: donor.make,
    model: donor.model,
    color: donor.color,
    stockNumber: donor.stockNumber,
    imageUrl:
      photoHash === null
        ? null
        : chesterfieldPhotoOrigin(appOrigin) +
          "/api/inventory-photos/" +
          photoHash,
    availableDate: donor.availableDate,
    locationCode: yard.code,
    locationName: yard.name,
    locationCity: yard.city,
    state: "Virginia",
    stateAbbr: "VA",
    lat: yard.lat,
    lng: yard.lng,
    section: null,
    row: donor.position,
    space: null,
    detailsUrl: CHESTERFIELD_INVENTORY_URL,
    partsUrl: null,
    pricesUrl: null,
    engine: donor.engine,
    trim: null,
    transmission: null,
  };
}
