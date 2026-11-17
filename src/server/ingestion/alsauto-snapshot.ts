import {
  ALSAUTO_CATALOG,
  ALSAUTO_MINIMUM_INVENTORY,
  ALSAUTO_YARD,
} from "./alsauto-configuration";
import type { AlsautoRecord } from "./alsauto-parser";
import { inventoryVinWithCheckDigit } from "./inventory-vin-check-digit";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import { vinplusOptionalText } from "./vinplus-protocol";

export type AlsautoVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "alsauto";
};
const validVin = (record: AlsautoRecord) =>
  record.vin.length === 17
    ? inventoryVinWithCheckDigit(record.vin, String(record.year))
    : null;
export function alsautoSnapshot(
  records: readonly AlsautoRecord[],
  previousAcceptedCount: number | null,
  now = new Date(),
) {
  const identities = new Map<string, Set<string>>();
  for (const record of records) {
    const vin = validVin(record);
    if (vin)
      identities.set(
        vin,
        new Set([
          ...(identities.get(vin) ?? []),
          JSON.stringify([
            record.lot,
            record.year,
            record.make,
            record.model,
            record.acquired,
          ]),
        ]),
      );
  }
  const vehicles = new Map<string, AlsautoVehicle>();
  const observedVins = new Set<string>();
  const rejected: AlsautoRecord[] = [];
  const accounting = {
    recordsProcessed: records.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  for (const record of records) {
    const vin = validVin(record);
    const make = vinplusOptionalText(record.make),
      model = vinplusOptionalText(record.model);
    if (
      !vin ||
      !make ||
      !model ||
      record.year < 1886 ||
      record.year > 2100 ||
      (identities.get(vin)?.size ?? 0) > 1
    ) {
      rejected.push(record);
      accounting.recordsRejected++;
      if (vin) observedVins.add(vin);
      continue;
    }
    if (vehicles.has(vin)) {
      accounting.duplicateVehicles++;
      continue;
    }
    vehicles.set(vin, {
      source: "alsauto",
      vin,
      year: record.year,
      make: normalizeCanonicalMake(make === "NISS" ? "NISSAN" : make),
      model,
      stockNumber: record.lot,
      availableDate: record.acquired,
      locationCode: ALSAUTO_YARD.code,
      locationName: ALSAUTO_YARD.name,
      locationCity: ALSAUTO_YARD.city,
      state: "Wisconsin",
      stateAbbr: "WI",
      lat: ALSAUTO_YARD.lat,
      lng: ALSAUTO_YARD.lng,
      detailsUrl: ALSAUTO_CATALOG,
      partsUrl: null,
      pricesUrl: null,
      // Native photos come from the acquisition auction, not current yard stock.
      imageUrl: null,
      color: null,
      row: null,
      section: null,
      space: null,
      trim: null,
      engine: null,
      transmission: null,
    });
  }
  const errors: string[] = [];
  if (vehicles.size < ALSAUTO_MINIMUM_INVENTORY)
    errors.push(
      `Al's accepted ${vehicles.size}, below fixed source floor ${ALSAUTO_MINIMUM_INVENTORY}`,
    );
  if (
    accounting.recordsRejected / records.length >
    SourceValidationPolicy.maximumRejectionRatio
  )
    errors.push("Al's rejection ratio exceeds 10%");
  if (
    accounting.duplicateVehicles / records.length >
    SourceValidationPolicy.maximumDuplicateRatio
  )
    errors.push("Al's duplicate ratio exceeds 25%");
  if (
    previousAcceptedCount !== null &&
    (!Number.isSafeInteger(previousAcceptedCount) ||
      previousAcceptedCount < 0 ||
      vehicles.size <
        Math.floor(
          previousAcceptedCount *
            SourceValidationPolicy.minimumPreviousRunRatio,
        ))
  )
    errors.push("Al's inventory violates the previous-run 50% drift limit");
  const dates = [...vehicles.values()]
    .map((vehicle) => vehicle.availableDate ?? "")
    .sort();
  const newest = dates.at(-1) ?? "";
  const age = now.getTime() - Date.parse(newest + "T00:00:00Z");
  if (!Number.isFinite(age) || age < -86400000 || age > 61 * 86400000)
    errors.push(
      "Al's newest accepted acquisition is missing, future-dated or older than 60 days; verify the live inventory before retrying",
    );
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins].sort(),
    rejected,
    accounting,
    errors,
  };
}
