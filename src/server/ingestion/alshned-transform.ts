import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import type { CanonicalVehicle } from "./types";
import {
  alshnedHash,
  alshnedImage,
  type AlshnedDonor,
  type AlshnedPage,
} from "./alshned-parser";
import { ALSHNED_YARD } from "./alshned-yard-metadata";

export type AlshnedVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "alshned";
};
export type AlshnedAssessment = {
  donor: AlshnedDonor;
  observedVins: string[];
  signature: string;
} & (
  | { status: "accepted"; vehicle: AlshnedVehicle }
  | { status: "rejected"; reasons: string[] }
  | { status: "excluded" }
);
const optional = (v: string | null | undefined): string | null => {
  const s = v?.trim() ?? "";
  return /[a-z0-9]/i.test(s) &&
    !/^(?:other|unknown|none|null|n\/?a|0+)$/i.test(s)
    ? s
    : null;
};
export function assessAlshnedDonor(donor: AlshnedDonor): AlshnedAssessment {
  // The explicit native vendor must also occur in the independently published
  // donor title. Retain the entire source model description, including trim.
  const title = /^Donor vehicle (\d{4}) (.+)$/.exec(donor.title);
  const year = title?.[1] ?? "",
    rest = title?.[2] ?? "";
  const brand = optional(donor.brand),
    make = normalizeCanonicalMake(brand ?? "");
  const model =
    brand && rest.toLowerCase().startsWith(brand.toLowerCase() + " ")
      ? rest.slice(brand.length + 1).trim()
      : "";
  const vin = inventoryVin(donor.vin, year);
  const observedVins = [
    ...new Set(
      [donor.vin, donor.jsonVin, ...donor.vinClaims].flatMap((v) => {
        const parsed = inventoryVin(v, year);
        return parsed ? [parsed] : [];
      }),
    ),
  ];
  const reasons: string[] = [];
  if (
    !title ||
    Number(year) < 1886 ||
    Number(year) > 2100 ||
    !brand ||
    !/[a-z]/i.test(brand) ||
    !optional(model)
  )
    reasons.push("conflicting-native-make");
  if (!vin) reasons.push("missing-or-invalid-native-identity");
  if (donor.vin !== donor.jsonVin || observedVins.length > 1)
    reasons.push("conflicting-native-vin");
  if (donor.title !== donor.card.title || donor.heading !== donor.card.title)
    reasons.push("conflicting-native-heading");
  if (donor.brand.toLowerCase() !== donor.card.vendor.toLowerCase())
    reasons.push("conflicting-native-vendor");
  const common = {
    donor,
    observedVins,
    signature: alshnedHash([
      donor.title,
      donor.heading,
      donor.brand.toLowerCase(),
      donor.card.vendor.toLowerCase(),
      donor.active,
    ]),
  };
  if (!donor.active) return { ...common, status: "excluded" };
  if (reasons.length || !vin) return { ...common, status: "rejected", reasons };
  const vehicle: AlshnedVehicle = {
    source: "alshned",
    vin,
    year: Number(year),
    make,
    model,
    stockNumber: optional(donor.stock),
    color: normalizeCanonicalColor(optional(donor.fields["Exterior Color"])),
    imageUrl: alshnedImage(donor.imageUrl),
    availableDate: null,
    locationCode: ALSHNED_YARD.code,
    locationName: ALSHNED_YARD.name,
    locationCity: ALSHNED_YARD.city,
    state: "Pennsylvania",
    stateAbbr: "PA",
    lat: ALSHNED_YARD.lat,
    lng: ALSHNED_YARD.lng,
    detailsUrl: donor.card.url,
    partsUrl: null,
    pricesUrl: null,
    section: null,
    row: null,
    space: null,
    engine: optional(donor.fields.Engine),
    transmission: optional(donor.fields.Transmission),
    trim: null,
  };
  return { ...common, status: "accepted", vehicle };
}
export function alshnedSnapshot(
  pages: readonly AlshnedPage[],
  donors: readonly AlshnedDonor[],
) {
  const cards = pages.flatMap((p) => p.cards);
  if (
    !pages.length ||
    pages.length !== pages[0]?.lastPage ||
    cards.length !== pages[0]?.total ||
    donors.length !== cards.length ||
    donors.some((d, i) => alshnedHash(d.card) !== alshnedHash(cards[i]))
  )
    throw new Error(
      "Alshned snapshot is missing the complete ordered native donor frontier",
    );
  const assessments = donors.map(assessAlshnedDonor),
    groups = new Map<string, Set<string>>();
  for (const a of assessments)
    for (const vin of a.observedVins)
      groups.set(vin, new Set([...(groups.get(vin) ?? []), a.signature]));
  const conflicts = new Set(
    [...groups]
      .filter(([, signatures]) => signatures.size > 1)
      .map(([vin]) => vin),
  );
  const vehicles = new Map<string, AlshnedVehicle>();
  const rejections: { handle: string; reasons: string[] }[] = [];
  let duplicateVehicles = 0;
  let recordsExcluded = 0;
  const observedVins = new Set<string>();
  for (const a of assessments) {
    const conflict = a.observedVins.some((v) => conflicts.has(v));
    if (a.status === "excluded" && !conflict) {
      recordsExcluded++;
      continue;
    }
    for (const vin of a.observedVins) observedVins.add(vin);
    if (a.status !== "accepted" || conflict)
      rejections.push({
        handle: a.donor.card.handle,
        reasons: [
          ...(a.status === "rejected" ? a.reasons : []),
          ...(conflict ? ["conflicting-native-identity-claims"] : []),
        ],
      });
    else if (vehicles.has(a.vehicle.vin)) duplicateVehicles++;
    else vehicles.set(a.vehicle.vin, a.vehicle);
  }
  return {
    vehicles: [...vehicles.values()],
    accounting: {
      recordsProcessed: donors.length,
      recordsRejected: rejections.length,
      recordsExcluded,
      duplicateVehicles,
    },
    rejections,
    observedVins: [...observedVins].sort(),
    conflictingVins: [...conflicts].sort(),
  };
}
export function validateAlshnedSnapshot(
  snapshot: ReturnType<typeof alshnedSnapshot>,
  previousAcceptedCount: number | null = null,
) {
  const a = snapshot.accounting,
    n = snapshot.vehicles.length,
    active = a.recordsProcessed - a.recordsExcluded;
  if (
    (previousAcceptedCount !== null &&
      (!Number.isSafeInteger(previousAcceptedCount) ||
        previousAcceptedCount < 0)) ||
    !n ||
    a.recordsProcessed !==
      n + a.recordsRejected + a.recordsExcluded + a.duplicateVehicles ||
    a.recordsRejected / active > SourceValidationPolicy.maximumRejectionRatio ||
    a.duplicateVehicles / active >
      SourceValidationPolicy.maximumDuplicateRatio ||
    (previousAcceptedCount !== null &&
      n <
        previousAcceptedCount * SourceValidationPolicy.minimumPreviousRunRatio)
  )
    throw new Error(
      "Alshned complete census failed required rejection, duplicate, reconciliation or previous-count drift guards; prior inventory is preserved",
    );
  return snapshot;
}
