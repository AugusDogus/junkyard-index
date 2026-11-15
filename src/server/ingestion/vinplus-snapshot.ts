import { vinplusHash } from "./vinplus-parser";
import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";
import {
  vinplusOptionalText,
  vinplusStableRecord,
  type VinplusRecord,
} from "./vinplus-protocol";
import { vinplusPublicDate } from "./vinplus-public-enrichment";
import type { VinplusTenant } from "./vinplus-configuration";
import type { CanonicalVehicle } from "./types";

export function vinplusSnapshot(
  tenant: VinplusTenant,
  records: readonly VinplusRecord[],
) {
  const vehicles: CanonicalVehicle[] = [];
  const observedVins: string[] = [];
  const seen = new Map<string, string>();
  let rejected = 0,
    duplicates = 0;
  const { yard } = tenant;
  if (
    yard.lat === null ||
    yard.lng === null ||
    (yard.lat === 0 && yard.lng === 0)
  )
    throw new Error("Physical yard requires verified nonzero coordinates");
  const stocks = new Map<string, VinplusRecord[]>();
  for (const record of records)
    stocks.set(record.stock, [...(stocks.get(record.stock) ?? []), record]);
  for (const versions of stocks.values()) {
    const record = versions[0];
    if (!record) throw new Error("Stock group is empty");
    // Conflicting stock identities remain one rejected donor with no asserted
    // VIN, matching Pickers' stock association rule. Whole records stay in evidence.
    if (
      new Set(versions.map((value) => vinplusHash(vinplusStableRecord(value))))
        .size !== 1
    ) {
      rejected++;
      continue;
    }
    const vin =
      typeof record.vin === "string"
        ? inventoryVin(record.vin, String(record.year))
        : null;
    const make = vinplusOptionalText(record.make),
      model = vinplusOptionalText(record.model);
    if (!vin || !make || !model) {
      rejected++;
      if (vin) observedVins.push(vin);
      continue;
    }
    const identity = JSON.stringify([
      record.year,
      normalizeCanonicalMake(make),
      model,
    ]);
    const prior = seen.get(vin);
    if (prior !== undefined) {
      if (prior !== identity)
        throw new Error(
          "Different stocks contradict year/make/model for VIN " + vin,
        );
      duplicates++;
      continue;
    }
    seen.set(vin, identity);
    vehicles.push({
      source: "vinplus",
      vin,
      year: record.year,
      make: normalizeCanonicalMake(make),
      model,
      color: normalizeCanonicalColor(vinplusOptionalText(record.color)),
      stockNumber: record.stock,
      // These tenants publish no verified stock-bound photo host contract.
      imageUrl: null,
      availableDate: vinplusPublicDate(record.dateAdded)?.value ?? null,
      locationCode: yard.code,
      locationName: yard.name,
      locationCity: yard.city,
      state: normalizeRegion(yard.state).state,
      stateAbbr: yard.state,
      lat: yard.lat,
      lng: yard.lng,
      section: null,
      row: vinplusOptionalText(record.vehicleRow),
      space: null,
      detailsUrl: yard.websiteUrl,
      partsUrl: null,
      pricesUrl: null,
      engine: vinplusOptionalText(record.engine),
      trim: null,
      transmission: vinplusOptionalText(record.transmission),
    });
  }
  if (
    rejected / stocks.size > 0.1 ||
    duplicates / stocks.size > 0.25 ||
    vehicles.length < tenant.minimum
  )
    throw new Error(
      `${yard.name}: ${vehicles.length} accepted, ${rejected} rejected and ${duplicates} duplicate donors out of ${stocks.size}; per-yard floor, 10% rejection or 25% duplicate guard failed`,
    );
  return {
    vehicles,
    observedVins,
    accounting: {
      recordsProcessed: stocks.size,
      recordsRejected: rejected,
      recordsExcluded: 0,
      duplicateVehicles: duplicates,
    },
  };
}
