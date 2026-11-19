import type { ArrivalWindow } from "./arrival-window";
import type { SearchArea } from "./search-area";
import { SearchYardSelection } from "./search-yard-selection";
import type { YardType } from "~/lib/yard-service";
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
  yardTypes: YardType[];
  yearRange: [number, number];
  arrivalWindow?: ArrivalWindow;
  near?: SearchArea;
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
    yardTypes: SearchYardSelection.effectiveTypes(
      SearchYardSelection.fromSaved(filters.yardTypes),
    ),
    yearRange: [Math.min(min, max), Math.max(min, max)],
    arrivalWindow: filters.arrivalWindow,
    near: filters.near,
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
  const defaultYearRange =
    value.yearRange[0] === SEARCHABLE_VEHICLE_YEAR_RANGE.min &&
    value.yearRange[1] === SEARCHABLE_VEHICLE_YEAR_RANGE.max;
  const filters = filtersSchema.safeParse({
    vinPattern: commit.kind === "vin" ? commit.value : undefined,
    makes: value.makes.length ? value.makes : undefined,
    colors: value.colors.length ? value.colors : undefined,
    states: value.states.length ? value.states : undefined,
    salvageYards: value.salvageYards.length ? value.salvageYards : undefined,
    sources: value.sources.length ? value.sources : undefined,
    yardTypes: value.yardTypes.length ? value.yardTypes : undefined,
    minYear: defaultYearRange ? undefined : value.yearRange[0],
    maxYear: defaultYearRange ? undefined : value.yearRange[1],
    arrivalWindow: value.arrivalWindow,
    near: value.near,
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
