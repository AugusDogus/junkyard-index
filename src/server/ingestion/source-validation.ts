import type { IngestionSource } from "~/lib/ingestion-source";

const MINIMUM_UNIQUE_INVENTORY: Record<IngestionSource, number> = {
  row52: 10_000,
  pyp: 5_000,
  autorecycler: 100,
  pullapart: 5_000,
  upullitne: 500,
  upullitdavie: 250,
  gopullit: 500,
  pullnsave: 5_000,
  tearapart: 500,
  wrenchapart: 9_000,
  upullrparts: 2_000,
  ipullupull: 3_000,
  upullitwa: 1_500,
  partsgalore: 500,
  rtp: 1_000,
  nvpap: 2_500,
  pontiac: 1_000,
  // Native inline table: 130 complete of 141 rows on 2026-11-11.
  aero: 100,
  // Three native yards: 2,111 field-complete donors on 2026-11-11.
  chesterfield: 1_800,
  midway: 600,
  rightway: 450,
  ddauto: 50,
  rivervalley: 1_300,
  fenix: 4_000,
  importapart: 60,
  bigtruckpage: 40,
  denton: 2_000,
  // Complete native model/arrivals union: 2,158 accepted donors.
  oem: 1_800,
  // Complete dual-sort native catalog: 579 accepted of 587 items.
  dutchers: 500,
  // Complete native inline report: 661 accepted of 680 rows.
  chasencars: 550,
  oemgarage: 200,
  hagerman: 5,
  kandr: 40,
  // Complete native NN38 model graph: 3,649 accepted among 4,016 rows.
  jimsimport: 3_000,
  beavers: 240,
  indianriver: 900,
  army: 200,
  idipull: 450,
  littleton: 900,
  michigantruck: 150,
  joliet: 1_200,
  alln1: 900,
  millerstown: 900,
  // Two complete native Virginia catalogs: 7,422 unique donors on 2026-11-12.
  pickapartva: 6_500,
  // Complete native Parts Vehicles census: 24 unique donors on 2026-11-12.
  mccauley: 20,
  // Complete finite native model/arrival union: 2,326 unique donors.
  aviation: 2_000,
  // Complete finite native model/arrival union: 1,063 unique donors.
  chaz: 900,
  // Complete six-page native catalog: 171 unique donors.
  citymotors: 150,
  // Complete eight-page native catalog: 183 unique donors.
  awap: 160,
  // Complete native roster and primary details: 177 unique donors.
  clearsalvage: 150,
  // Complete finite native model/arrival union: 1,222 unique donors.
  aplus: 1_000,
  // Complete finite native model census: 5,957 unique donors.
  central: 5_000,
  // Complete finite native vehicle-tab census: 1,254 unique donors.
  coutu: 1_000,
  // Complete finite native roster: 38 unique donors.
  kodak: 30,
  // Complete native four-page catalog:69 Heyworth and2 Armington donors.
  cars4parts: 56,
  // Complete full inventory with its secondary view checked:1,415 donors.
  meeks: 1_200,
  // Complete native union: 1,807 active donors, 11 rejects, 209 inactive.
  brandywine: 1_500,
  // Complete 630-model native graph and arrivals union, qualified locally only.
  calton: 11_000,
};

const MINIMUM_PREVIOUS_RUN_RATIO = 0.5;
const MAXIMUM_DUPLICATE_RATIO = 0.25;
const MAXIMUM_REJECTION_RATIO = 0.1;

export interface SourceValidationInput {
  source: IngestionSource;
  terminal: boolean;
  uniqueVehicles: number;
  vehiclesProcessed: number;
  duplicateVehicles: number;
  rejectedVehicles: number;
  errors: string[];
  previousAcceptedCount: number | null;
}

export type SourceValidationResult =
  | { status: "accepted"; errors: [] }
  | { status: "rejected"; errors: string[] };

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : numerator / denominator;
}

export function validateSourceSnapshot(
  input: SourceValidationInput,
): SourceValidationResult {
  const errors = [...input.errors];
  if (!input.terminal) {
    errors.push(`${input.source} did not provide terminal cursor evidence`);
  }

  const minimum = MINIMUM_UNIQUE_INVENTORY[input.source];
  if (input.uniqueVehicles < minimum) {
    errors.push(
      `${input.source} produced ${input.uniqueVehicles} unique vehicles; minimum is ${minimum}`,
    );
  }

  if (
    input.previousAcceptedCount !== null &&
    input.uniqueVehicles <
      Math.floor(input.previousAcceptedCount * MINIMUM_PREVIOUS_RUN_RATIO)
  ) {
    errors.push(
      `${input.source} inventory fell from ${input.previousAcceptedCount} to ${input.uniqueVehicles}, below the 50% drift limit`,
    );
  }

  const observed =
    input.uniqueVehicles + input.duplicateVehicles + input.rejectedVehicles;
  const duplicateRatio = ratio(input.duplicateVehicles, observed);
  if (duplicateRatio > MAXIMUM_DUPLICATE_RATIO) {
    errors.push(
      `${input.source} duplicate ratio ${(duplicateRatio * 100).toFixed(1)}% exceeds 25%`,
    );
  }
  const rejectionRatio = ratio(input.rejectedVehicles, observed);
  if (rejectionRatio > MAXIMUM_REJECTION_RATIO) {
    errors.push(
      `${input.source} rejection ratio ${(rejectionRatio * 100).toFixed(1)}% exceeds 10%`,
    );
  }

  return errors.length === 0
    ? { status: "accepted", errors: [] }
    : { status: "rejected", errors: [...new Set(errors)] };
}

export const SourceValidationPolicy = {
  minimumUniqueInventory: MINIMUM_UNIQUE_INVENTORY,
  minimumPreviousRunRatio: MINIMUM_PREVIOUS_RUN_RATIO,
  maximumDuplicateRatio: MAXIMUM_DUPLICATE_RATIO,
  maximumRejectionRatio: MAXIMUM_REJECTION_RATIO,
} as const;
