import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import { validateSourceSnapshot } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import type { CstruckRecord } from "./cstruck-parser";
import { CSTRUCK_YARD } from "./cstruck-yard-metadata";

export type CstruckVehicle = CanonicalVehicle & { source: "cstruck" };
const key = (raw: string) => raw.trim().replace(/\s+/g, " ").toUpperCase();
const missing = (raw: string) =>
  /^(?:|UNKNOWN|OTHER|NONE|NULL|N\/?A|-|0+)$/.test(key(raw));
/** Standard North American check digit, used here because the complete source
 * audit found a wrong-year record that passes the shared format-only gate. */
export function cstruckChecksum(vin: string): boolean {
  const transliteration: Record<string, number> = {
    A: 1,
    B: 2,
    C: 3,
    D: 4,
    E: 5,
    F: 6,
    G: 7,
    H: 8,
    J: 1,
    K: 2,
    L: 3,
    M: 4,
    N: 5,
    P: 7,
    R: 9,
    S: 2,
    T: 3,
    U: 4,
    V: 5,
    W: 6,
    X: 7,
    Y: 8,
    Z: 9,
  };
  const weights = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (const [index, char] of [...vin].entries()) {
    const value = /^\d$/.test(char) ? Number(char) : transliteration[char],
      weight = weights[index];
    if (value === undefined || weight === undefined) return false;
    sum += value * weight;
  }
  const remainder = sum % 11;
  return (
    vin.length === 17 && vin[8] === (remainder === 10 ? "X" : String(remainder))
  );
}
export function cstruckSnapshot(
  records: readonly CstruckRecord[],
  previousAcceptedCount: number | null,
) {
  const vehicles = new Map<string, CstruckVehicle>(),
    observedVins = new Set<string>();
  const rejects: { id: string; vin: string | null; reason: string }[] = [];
  const accounting = {
    recordsProcessed: records.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  for (const r of records) {
    const vin = inventoryVin(r.vin, r.year);
    // This native UD listing was independently verified as a RAM VIN. Keep it
    // quarantined, never repair its make/model using decoder-derived metadata.
    const mismatch = vin === "3C63RRGL9LG210160";
    const invalid =
      !vin ||
      (Number(r.year) >= 1981 && !cstruckChecksum(vin)) ||
      !/^\d{4}$/.test(r.year) ||
      Number(r.year) < 1886 ||
      Number(r.year) > 2100 ||
      missing(r.make) ||
      missing(r.model) ||
      key(r.make) === "TRAILER" ||
      mismatch;
    if (invalid) {
      accounting.recordsRejected++;
      if (vin) observedVins.add(vin);
      rejects.push({
        id: r.id,
        vin,
        reason: mismatch
          ? "verified-native-VIN-mismatch"
          : "required-vehicle-identity",
      });
      continue;
    }
    const vehicle: CstruckVehicle = {
      source: "cstruck",
      vin,
      year: Number(r.year),
      make: normalizeCanonicalMake(r.make),
      model: r.model,
      stockNumber: null,
      color: null,
      imageUrl: r.imageUrl,
      availableDate: null,
      locationCode: CSTRUCK_YARD.code,
      locationName: CSTRUCK_YARD.name,
      locationCity: CSTRUCK_YARD.city,
      state: "South Dakota",
      stateAbbr: "SD",
      lat: CSTRUCK_YARD.lat,
      lng: CSTRUCK_YARD.lng,
      detailsUrl: r.url,
      partsUrl: null,
      pricesUrl: null,
      engine: r.engine ?? null,
      trim: null,
      transmission: r.transmission ?? null,
      section: null,
      row: null,
      space: null,
    };
    const prior = vehicles.get(vin);
    if (prior) {
      if (
        prior.year !== vehicle.year ||
        key(prior.make) !== key(vehicle.make) ||
        key(prior.model) !== key(vehicle.model)
      )
        throw new Error(
          "C&S separate items conflict on required claims for one VIN",
        );
      accounting.duplicateVehicles++;
    } else vehicles.set(vin, vehicle);
  }
  if ([...observedVins].some((vin) => vehicles.has(vin)))
    throw new Error(
      "C&S rejected identity also has an eligible item; inspect every native claim",
    );
  const validation = validateSourceSnapshot({
    source: "cstruck",
    terminal: true,
    uniqueVehicles: vehicles.size,
    vehiclesProcessed: records.length,
    duplicateVehicles: accounting.duplicateVehicles,
    rejectedVehicles: accounting.recordsRejected,
    errors: [],
    previousAcceptedCount,
  });
  if (validation.status === "rejected")
    throw new Error(validation.errors.join("; "));
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins],
    rejects,
    accounting,
  };
}
