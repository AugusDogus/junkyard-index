import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import {
  KandrNative,
  type KandrCard,
  type KandrDetail,
  type KandrListing,
} from "./kandr-native";

// Exact-address Census match, 2026-11-15: TIGER 11442317, side L, range 868..700.
// Street-range interpolation, not a rooftop or parcel point.
export const KANDR_YARD = {
  source: "kandr",
  code: "holland",
  name: "K&R Truck Parts",
  operator: "K&R Truck Sales / West Michigan International",
  address: "840 Interchange Drive",
  city: "Holland",
  state: "MI",
  postalCode: "49423",
  phone: "616-392-8377",
  email: null,
  lat: 42.740238356939,
  lng: -86.071435768538,
  websiteUrl: "https://kandrtruckparts.com/",
} as const;
export type KandrVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "kandr";
};
export interface KandrSnapshot {
  vehicles: KandrVehicle[];
  observedVins: string[];
  accounting: {
    recordsProcessed: number;
    recordsRejected: number;
    recordsExcluded: number;
    duplicateVehicles: number;
  };
  rejects: { id: string; reasons: string[]; validVins: string[] }[];
}
const scalar = (values: readonly string[]) => {
  const unique = [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ];
  return unique.length === 1 ? (unique[0] ?? "") : "";
};
const usable = (raw: string) =>
  /[a-z0-9]/i.test(raw) &&
  !/^(?:unknown|other|n\/?a|none|null|undefined|[-?]+)$/i.test(raw);
function assess(card: KandrCard, detail: KandrDetail) {
  const reasons: string[] = [];
  const claim = (name: string) => detail.fields[name] ?? [];
  const yearRaw = scalar(claim("Year")),
    make = scalar(claim("Vehicle Make")),
    model = scalar(claim("Vehicle Model"));
  const year = Number(yearRaw),
    vin = inventoryVin(scalar(claim("VIN")), yearRaw);
  const validVins = [
    ...new Set(
      claim("VIN").flatMap((raw) => {
        // Keep identity presence independently of the rejection caused by
        // conflicting descriptive years, including supported older serials.
        return [yearRaw, ...claim("Year")].flatMap((nativeYear) => {
          const candidate = inventoryVin(raw, nativeYear);
          return candidate === null ? [] : [candidate];
        });
      }),
    ),
  ];
  if (
    !/^\d{4}$/.test(yearRaw) ||
    year < 1886 ||
    year > new Date().getUTCFullYear() + 1
  )
    reasons.push("missing-or-invalid-native-year");
  if (!usable(make) || !usable(model) || !/[a-z]/i.test(make))
    reasons.push("missing-native-make-model");
  if (!vin) reasons.push("missing-or-conflicting-native-vin");
  const title = `${yearRaw} ${make} ${model} ${KandrNative.categories[detail.category]}`;
  // Native headings use Part Manufacturer/Part Model. Three real donors omit
  // Part Manufacturer while retaining Vehicle Make and matching listing YMM.
  const partMake = scalar(claim("Part Manufacturer"));
  const partModel = scalar(claim("Part Model"));
  const detailTitle = KandrNative.text(
    `${yearRaw} ${partMake} ${partModel} ${KandrNative.categories[detail.category]}`,
  );
  if (
    card.titles.some((value) => value !== title) ||
    detail.title !== detailTitle ||
    (partMake !== "" && partMake !== make) ||
    (partModel !== "" && partModel !== model) ||
    scalar(card.fields.Year ?? []) !== yearRaw ||
    scalar(card.fields.Make ?? []) !== make ||
    scalar(card.fields.Model ?? []) !== model
  )
    reasons.push("native-listing-detail-identity-conflict");
  if (
    ["Year", "Vehicle Make", "Vehicle Model", "VIN"].some(
      (name) => new Set(claim(name)).size > 1,
    )
  )
    reasons.push("conflicting-native-required-claims");
  // Saved concrete component-only contradiction stays quarantined until reviewed.
  if (
    detail.id === "6483483/1/81643" ||
    detail.descriptions.some((value) =>
      /^used refrigerator cabinet\.?$/i.test(value),
    )
  )
    reasons.push("component-only-scope-conflict");
  const quantity = scalar(claim("Available Quantity"));
  if (quantity && (!/^\d+$/.test(quantity) || Number(quantity) === 0))
    reasons.push("native-donor-unavailable-or-invalid-quantity");
  return { card, detail, year, make, model, vin, validVins, reasons };
}

function create(
  pages: readonly KandrListing[],
  details: readonly KandrDetail[],
): KandrSnapshot {
  const cards = pages.flatMap((page) => page.cards);
  if (
    cards.length !== details.length ||
    cards.some((card, index) => {
      const detail = details[index];
      return !detail || card.id !== detail.id || card.url !== detail.url;
    })
  )
    throw new Error("K&R complete listing/detail graph does not reconcile");
  const rows = cards.map((card, index) => {
    const detail = details[index];
    if (!detail) throw new Error("K&R donor detail disappeared");
    return assess(card, detail);
  });
  const groups = new Map<string, Set<number>>();
  rows.forEach((row, index) => {
    for (const key of [
      "id:" + row.card.id,
      ...row.validVins.map((vin) => "vin:" + vin),
    ]) {
      const group = groups.get(key) ?? new Set<number>();
      group.add(index);
      groups.set(key, group);
    }
  });
  const rejected = new Set<number>();
  rows.forEach((row, index) => {
    if (row.reasons.length) rejected.add(index);
  });
  for (const group of groups.values()) {
    const signatures = new Set(
      [...group].map((index) => {
        const row = rows[index];
        return row
          ? JSON.stringify([
              row.card.id,
              row.year,
              row.make,
              row.model,
              row.validVins,
            ])
          : "missing";
      }),
    );
    if (signatures.size > 1)
      for (const index of group) {
        rejected.add(index);
        rows[index]?.reasons.push("global-native-identity-conflict");
      }
  }
  // Propagate rejected identity presence across both VIN and donor-id joins.
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups.values())
      if ([...group].some((index) => rejected.has(index))) {
        for (const index of group)
          if (!rejected.has(index)) {
            rejected.add(index);
            rows[index]?.reasons.push("connected-native-identity-conflict");
            changed = true;
          }
      }
  }
  const vehicles = new Map<string, KandrVehicle>(),
    observed = new Set<string>();
  const snapshot: KandrSnapshot = {
    vehicles: [],
    observedVins: [],
    accounting: {
      recordsProcessed: rows.length,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
    rejects: [],
  };
  rows.forEach((row, index) => {
    if (rejected.has(index) || !row.vin) {
      snapshot.accounting.recordsRejected++;
      row.validVins.forEach((vin) => observed.add(vin));
      snapshot.rejects.push({
        id: row.card.id,
        reasons: row.reasons,
        validVins: row.validVins,
      });
      return;
    }
    const stock = scalar([
      ...(row.card.fields["Tag #"] ?? []),
      ...(row.detail.fields["Tag #"] ?? []),
    ]);
    const candidate: KandrVehicle = {
      source: "kandr",
      vin: row.vin,
      year: row.year,
      make: normalizeCanonicalMake(row.make),
      model: row.model,
      stockNumber: usable(stock) ? stock : null,
      imageUrl: row.detail.images[0] ?? null,
      color: null,
      availableDate: null,
      locationCode: KANDR_YARD.code,
      locationName: KANDR_YARD.name,
      locationCity: KANDR_YARD.city,
      state: "Michigan",
      stateAbbr: "MI",
      lat: KANDR_YARD.lat,
      lng: KANDR_YARD.lng,
      section: null,
      row: null,
      space: null,
      detailsUrl: row.detail.url,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    };
    const previous = vehicles.get(row.vin);
    if (previous) {
      snapshot.accounting.duplicateVehicles++;
      if (previous.stockNumber !== candidate.stockNumber)
        previous.stockNumber = null;
      if (previous.imageUrl !== candidate.imageUrl) previous.imageUrl = null;
    } else vehicles.set(row.vin, candidate);
  });
  snapshot.vehicles = [...vehicles.values()];
  snapshot.observedVins = [...observed].sort();
  return snapshot;
}
function validate(
  snapshot: KandrSnapshot,
  minimum: number,
  previous: number | null,
): void {
  const a = snapshot.accounting;
  if (
    !Number.isSafeInteger(minimum) ||
    minimum < 1 ||
    (previous !== null && (!Number.isSafeInteger(previous) || previous < 0))
  )
    throw new Error(
      "K&R floor and previous count must be valid nonnegative integers",
    );
  if (
    snapshot.vehicles.length < minimum ||
    (previous !== null &&
      snapshot.vehicles.length <
        Math.floor(previous * SourceValidationPolicy.minimumPreviousRunRatio))
  )
    throw new Error(
      "K&R accepted inventory failed its minimum or 50% drift guard",
    );
  if (
    a.recordsProcessed !==
      snapshot.vehicles.length +
        a.recordsRejected +
        a.recordsExcluded +
        a.duplicateVehicles ||
    a.recordsRejected / a.recordsProcessed >
      SourceValidationPolicy.maximumRejectionRatio ||
    a.duplicateVehicles / a.recordsProcessed >
      SourceValidationPolicy.maximumDuplicateRatio
  )
    throw new Error(
      "K&R complete-source accounting, rejection or duplicate guard failed",
    );
}
export const KandrSnapshot = { create, validate } as const;
