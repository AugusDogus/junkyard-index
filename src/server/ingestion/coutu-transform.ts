import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import type { CanonicalVehicle } from "./types";
import type { CoutuRecord } from "./coutu-parser";
import { coutuDonorUrl, coutuImage } from "./coutu-protocol";
import { COUTU_YARD } from "./coutu-yard-metadata";

export type CoutuCanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "coutu";
};
export type CoutuRecordResult =
  | { status: "available"; vehicle: CoutuCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };
const unusable = (raw: string) =>
  !/[A-Z0-9]/i.test(raw) ||
  /^(?:other|unknown|n\/?a|none|null|undefined|[-?]+)$/i.test(raw);

/** Presence uses every native year claim, including required-rejected rows. */
export function coutuVin(record: CoutuRecord): string | null {
  return (
    inventoryVin(record[0], record[1]) ?? inventoryVin(record[0], record[2])
  );
}

export function transformCoutuRecord(record: CoutuRecord): CoutuRecordResult {
  const [
    rawVin,
    chipYear,
    headerYear,
    make,
    model,
    breadcrumbMake,
    breadcrumbModel,
    stock,
    destination,
    image,
  ] = record;
  const vin = coutuVin(record);
  const year = Number(chipYear);
  const detailsUrl = coutuDonorUrl(destination);
  if (
    !vin ||
    !inventoryVin(rawVin, chipYear) ||
    !/^\d{4}$/.test(chipYear) ||
    year < 1886 ||
    year > 2100 ||
    chipYear !== headerYear ||
    make !== breadcrumbMake ||
    model !== breadcrumbModel ||
    unusable(make) ||
    unusable(model) ||
    !detailsUrl
  )
    return { status: "incomplete", vin };
  const { lat, lng } = COUTU_YARD;
  return {
    status: "available",
    vehicle: {
      source: "coutu",
      vin,
      year,
      make: normalizeCanonicalMake(make),
      model,
      stockNumber:
        /^[A-Z0-9][A-Z0-9-]{0,39}$/i.test(stock) && !unusable(stock)
          ? stock
          : null,
      imageUrl: coutuImage(image),
      availableDate: null,
      color: null,
      locationCode: COUTU_YARD.code,
      locationName: COUTU_YARD.name,
      locationCity: COUTU_YARD.city,
      state: "Connecticut",
      stateAbbr: "CT",
      lat,
      lng,
      detailsUrl,
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
