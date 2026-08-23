import type { IngestionSource } from "~/lib/ingestion-source";

const MINIMUM_UNIQUE_INVENTORY: Record<IngestionSource, number> = {
  row52: 10_000,
  pyp: 5_000,
  autorecycler: 100,
  pullapart: 5_000,
  upullitne: 500,
  upullitdavie: 250,
  gopullit: 500,
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
