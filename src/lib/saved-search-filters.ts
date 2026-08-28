import { z } from "zod";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { VinPattern } from "~/lib/vin-pattern";

const MIN_VEHICLE_YEAR = 1886;
const MAX_VEHICLE_YEAR = new Date().getUTCFullYear() + 1;

export const SEARCHABLE_VEHICLE_YEAR_RANGE = {
  min: 1900,
  max: MAX_VEHICLE_YEAR,
} as const;

export const filtersSchema = z.object({
  vinPattern: z
    .string()
    .max(VinPattern.maxInputLength)
    .refine(
      (value) => {
        const parsedPattern = VinPattern.parse(value);
        return (
          parsedPattern.success &&
          VinPattern.toAlgoliaFilter(parsedPattern.data) !== undefined
        );
      },
      {
        message:
          "VIN pattern must describe 17 valid positions and include a known character",
      },
    )
    .optional(),
  makes: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  salvageYards: z.array(z.string()).optional(),
  sources: z.array(z.enum(INGESTION_SOURCES)).optional(),
  minYear: z
    .number()
    .int()
    .min(MIN_VEHICLE_YEAR)
    .max(MAX_VEHICLE_YEAR)
    .optional(),
  maxYear: z
    .number()
    .int()
    .min(MIN_VEHICLE_YEAR)
    .max(MAX_VEHICLE_YEAR)
    .optional(),
  sortBy: z.string().optional(),
});

export type SavedSearchFilters = z.infer<typeof filtersSchema>;

function canonicalFacetValues(values: string[] | undefined): string[] {
  return [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

/** Canonicalizes only fields that affect alert matching. */
export function savedSearchMatchCriteriaKey(
  query: string,
  filters: SavedSearchFilters,
): string {
  const parsedVinPattern = filters.vinPattern
    ? VinPattern.parse(filters.vinPattern)
    : null;
  const vinPattern =
    parsedVinPattern?.success === true
      ? parsedVinPattern.data.normalized
      : filters.vinPattern?.trim();
  const hasDefaultFullYearRange =
    filters.minYear === SEARCHABLE_VEHICLE_YEAR_RANGE.min &&
    filters.maxYear === SEARCHABLE_VEHICLE_YEAR_RANGE.max;
  const minimumYear = hasDefaultFullYearRange ? undefined : filters.minYear;
  const maximumYear = hasDefaultFullYearRange ? undefined : filters.maxYear;
  const yearsAreInverted =
    minimumYear !== undefined &&
    maximumYear !== undefined &&
    minimumYear > maximumYear;

  return JSON.stringify({
    query: query.trim(),
    vinPattern,
    makes: canonicalFacetValues(filters.makes),
    colors: canonicalFacetValues(filters.colors),
    states: canonicalFacetValues(filters.states),
    salvageYards: canonicalFacetValues(filters.salvageYards),
    sources: canonicalFacetValues(filters.sources),
    minYear: yearsAreInverted ? maximumYear : minimumYear,
    maxYear: yearsAreInverted ? minimumYear : maximumYear,
  });
}

export type SavedSearchFiltersParseResult =
  | {
      success: true;
      data: SavedSearchFilters;
    }
  | {
      success: false;
      reason: "malformed_json";
      error: SyntaxError;
    }
  | {
      success: false;
      reason: "invalid_schema";
      error: z.ZodError<SavedSearchFilters>;
    };

export function parseSavedSearchFilters(
  rawFiltersJson: string,
): SavedSearchFiltersParseResult {
  let rawFilters: unknown;
  try {
    rawFilters = JSON.parse(rawFiltersJson);
  } catch (error) {
    return {
      success: false,
      reason: "malformed_json",
      error:
        error instanceof SyntaxError ? error : new SyntaxError(String(error)),
    };
  }

  const filtersParseResult = filtersSchema.safeParse(rawFilters);
  if (filtersParseResult.success) {
    return filtersParseResult;
  }

  return {
    success: false,
    reason: "invalid_schema",
    error: filtersParseResult.error,
  };
}
