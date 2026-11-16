import { BIGD_MINIMUM_INVENTORY } from "./bigd-yard-metadata";
import { HARRYS_MINIMUM } from "./harrys-yard-metadata";
import { BUDGET_MINIMUM } from "./budget-yard-metadata";
import { URGIIS_MINIMUM_INVENTORY } from "./urgiis-configuration";
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
  nvpap: 1_092,
  pontiac: 435,
  // Native inline table: 130 complete of 141 rows on 2026-11-11.
  aero: 43,
  // Three native yards: 2,111 field-complete donors on 2026-11-11.
  chesterfield: 703,
  // Two native Utah XML/PHP catalogs: 1,727 complete donors on 2026-11-12.
  utpap: 575,
  // Complete native catalogs audited under the existing required-field contract.
  tritown: 156,
  whitebradstreet: 127,
  midway: 254,
  rightway: 181,
  ddauto: 22,
  rivervalley: 517,
  fenix: 1_531,
  importapart: 25,
  bigtruckpage: 16,
  // Complete native parting-out catalog: one active donor on 2026-11-13.
  speedys: 1,
  // Complete native Lithonia U-Pull report: 624 unique donors on 2026-11-15 UTC.
  sandw: 208,
  denton: 765,
  // Complete native make/model census: 976 accepted of 1,064 cards.
  scotts: 325,
  // Complete native model/arrivals union: 2,158 accepted donors.
  oem: 719,
  // Complete dual-sort native catalog: 579 accepted of 587 items.
  dutchers: 193,
  // Complete native inline report: 661 accepted of 680 rows.
  chasencars: 220,
  // Complete native catalog: 5,760 unique donors, 63 rejects, two duplicates.
  weberbrothers: 1_920,
  hawaiiparts: 14,
  modernmuscle: 115,
  oemgarage: 79,
  hagerman: 1,
  kandr: 16,
  // Complete native NN38 model graph: 3,649 accepted among 4,016 rows.
  jimsimport: 1_216,
  // Complete native census: 2,531 accepted, nine rejects, 19 inactive exclusions.
  lonestarimports: 843,
  // Complete 43-donor native catalog and details: 41 accepted, two rejects.
  alshned: 13,
  // 51 complete Hollander Stores yards, 55,958 accepted donors.
  hollanderstores: 18_638,
  // Complete C&S native store: 59 accepted of 64 items.
  cstruck: 19,
  // Six complete HTP supplier stores, with per-supplier quality floors.
  heavytruckparts: 277,
  // Complete 45-make, 482-model census: 2,507 accepted, 86 rejects, 778 exclusions.
  allied: 835,
  urgiis: URGIIS_MINIMUM_INVENTORY,
  byot: 1_775,
  vinplus: 2_498,
  beavers: 92,
  indianriver: 349,
  harrys: HARRYS_MINIMUM,
  budget: BUDGET_MINIMUM,
  army: 77,
  bigd: BIGD_MINIMUM_INVENTORY,
  // Fresh complete inline census: 535 accepted of 568 stocks.
  idipull: 178,
  pullsavewa: 688,
  littleton: 359,
  michigantruck: 57,
  joliet: 464,
  alln1: 364,
  grandpajohns: 212,
  pickers: 180,
  pipes: 178,
  uwrench: 373,
  millerstown: 362,
  // Two complete native Virginia catalogs: 7,422 unique donors on 2026-11-12.
  pickapartva: 2_474,
  // Complete native Parts Vehicles census: 24 unique donors on 2026-11-12.
  mccauley: 8,
  // Complete Pittsburgh native census: 25 unique donors on 2026-11-12.
  rustyhook: 8,
  // Complete finite native model/arrival union: 2,326 unique donors.
  aviation: 775,
  // Complete finite native model/arrival union: 1,063 unique donors.
  chaz: 354,
  // Complete six-page native catalog: 171 unique donors.
  citymotors: 57,
  // Complete eight-page native catalog: 183 unique donors.
  awap: 61,
  // Complete native roster and primary details: 177 unique donors.
  clearsalvage: 59,
  // Complete finite native model/arrival union: 1,222 unique donors.
  aplus: 407,
  // Complete finite native model census: 5,957 unique donors.
  central: 1_985,
  northwest: 2_229,
  // Complete finite native vehicle-tab census: 1,254 unique donors.
  coutu: 418,
  // Complete finite native roster: 38 unique donors.
  kodak: 12,
  // Complete native donor article census: 973 unique donors.
  six03: 324,
  // Complete native census: 286 active donors, one explicitly sold vehicle.
  rohner: 95,
  // Complete saved 468-model census: 5,930 clean candidates before arrivals union.
  pratt: 1_977,
  // Complete native four-page catalog:69 Heyworth and2 Armington donors.
  cars4parts: 24,
  // Complete full inventory with its secondary view checked:1,415 donors.
  meeks: 471,
  // Complete native union: 1,807 active donors, 11 rejects, 209 inactive.
  brandywine: 602,
  // Complete five-page Corinne census: 103 donors, one reject, two sale exclusions.
  rmmdtp: 34,
  // Complete 630-model native graph and arrivals union, qualified locally only.
  calton: 4_183,
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
  minimumUniqueInventory?: number;
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

  const minimum =
    input.minimumUniqueInventory ?? MINIMUM_UNIQUE_INVENTORY[input.source];
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
