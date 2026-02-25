import { z } from "zod";

const SOURCE_VALUES = ["pyp", "row52"] as const;
const MIN_VEHICLE_YEAR = 1886;
const MAX_VEHICLE_YEAR = new Date().getUTCFullYear() + 1;

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
