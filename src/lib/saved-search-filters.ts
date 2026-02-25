import { z } from "zod";

export const filtersSchema = z.object({
  makes: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  states: z.array(z.string()).optional(),
  salvageYards: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
  minYear: z.number().optional(),
  maxYear: z.number().optional(),
  sortBy: z.string().optional(),
});

export type SavedSearchFilters = z.infer<typeof filtersSchema>;
