import type { FacetFilters } from "algoliasearch/lite";
import { VehicleName } from "./vehicle-name";

/** Match a record's canonical make or the make under which it was saved. */
function aliases(make: string, sourceMake?: string | null): string[] {
  return [
    ...new Set([
      make,
      ...(sourceMake ? [sourceMake, VehicleName.makeName(sourceMake)] : []),
    ]),
  ];
}

/** Keep visible facets canonical while preserving saved refinement scope. */
function facets(filters: FacetFilters): FacetFilters {
  if (typeof filters === "string")
    return filters.replace(/^make:/, "makeAliases:");
  return filters.map(facets);
}

export const MakeFilter = { aliases, facets } as const;
