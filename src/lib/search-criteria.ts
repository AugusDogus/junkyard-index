import { SEARCH_SORT_OPTIONS } from "~/components/search/search-routing";
import { parseAdvancedSearchQuery } from "~/lib/advanced-search-query";
import type { IngestionSource } from "~/lib/ingestion-source";
import {
  filtersSchema,
  SEARCHABLE_VEHICLE_YEAR_RANGE,
  type SavedSearchFilters,
} from "~/lib/saved-search-filters";
import { VinPattern } from "~/lib/vin-pattern";
import { resolveSearchCommit } from "~/lib/search-commit";

/** The editable criteria shared by search, save, and edit flows. Query may be a VIN pattern. */
export type SearchCriteria = {
  query: string;
  queryMode: "keywords" | "vin";
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
  sources: IngestionSource[];
  yearRange: [number, number];
  sortBy: string;
};

function fromSavedSearch(
  query: string,
  filters: SavedSearchFilters,
): SearchCriteria {
  const sort = SEARCH_SORT_OPTIONS.find(
    (option) =>
      option.key === filters.sortBy || option.indexName === filters.sortBy,
  );
  const clamp = (year: number) =>
    Math.min(
      SEARCHABLE_VEHICLE_YEAR_RANGE.max,
      Math.max(SEARCHABLE_VEHICLE_YEAR_RANGE.min, year),
    );
  const min = clamp(filters.minYear ?? SEARCHABLE_VEHICLE_YEAR_RANGE.min);
  const max = clamp(filters.maxYear ?? SEARCHABLE_VEHICLE_YEAR_RANGE.max);
  return {
    query: filters.vinPattern ?? query,
    queryMode:
      filters.vinPattern || VinPattern.isSearchCandidate(query)
        ? "vin"
        : "keywords",
    makes: filters.makes ?? [],
    colors: filters.colors ?? [],
    states: filters.states ?? [],
    salvageYards: filters.salvageYards ?? [],
    sources: filters.sources ?? [],
    yearRange: [Math.min(min, max), Math.max(min, max)],
    sortBy: sort?.key ?? "newest",
  };
}

function toSavedSearch(
  value: SearchCriteria,
):
  | { success: true; data: { query: string; filters: SavedSearchFilters } }
  | { success: false; error: string } {
  const commit = resolveSearchCommit(value.query, true);
  if (
    commit.kind === "invalid-vin" ||
    (value.queryMode === "vin" && commit.kind !== "vin")
  ) {
    return {
      success: false,
      error: "Enter a complete 17-position VIN pattern or use keywords.",
    };
  }
  const query = commit.kind === "query" ? commit.value : "";
  const parsedQuery = parseAdvancedSearchQuery(query);
  if (!parsedQuery.success) return parsedQuery;
  const filters = filtersSchema.safeParse({
    vinPattern: commit.kind === "vin" ? commit.value : undefined,
    makes: value.makes.length ? value.makes : undefined,
    colors: value.colors.length ? value.colors : undefined,
    states: value.states.length ? value.states : undefined,
    salvageYards: value.salvageYards.length ? value.salvageYards : undefined,
    sources: value.sources.length ? value.sources : undefined,
    minYear: value.yearRange[0],
    maxYear: value.yearRange[1],
    sortBy: value.sortBy,
  });
  if (!filters.success) {
    return {
      success: false,
      error:
        filters.error.issues[0]?.message ?? "Review the filters and try again.",
    };
  }
  return { success: true, data: { query, filters: filters.data } };
}

export const SearchCriteria = { fromSavedSearch, toSavedSearch } as const;
