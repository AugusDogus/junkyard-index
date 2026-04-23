import { z } from "zod";
import {
  MAX_VEHICLE_YEAR,
  MIN_VEHICLE_YEAR,
} from "~/lib/search-filter-bounds";

const SOURCE_VALUES = [
  "pyp",
  "row52",
  "autorecycler",
  "pullapart",
  "upullitne",
] as const;

export const filtersSchema = z.object({
  makes: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  salvageYards: z.array(z.string()).optional(),
  sources: z.array(z.enum(SOURCE_VALUES)).optional(),
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
        error instanceof SyntaxError
          ? error
          : new SyntaxError(String(error)),
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
