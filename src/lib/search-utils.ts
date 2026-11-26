import type { ArrivalWindow } from "./arrival-window";
import type { SearchArea } from "./search-area";
import { SearchUrl } from "./search-url";
import { SearchYardSelection } from "./search-yard-selection";
import {
  getMaximumSearchableVehicleYear,
  getSearchableVinPattern,
  getSearchSortRouteKey,
  MINIMUM_SEARCHABLE_VEHICLE_YEAR,
} from "~/components/search/search-routing";
import type { YardType } from "~/lib/yard-service";
interface SearchFilters {
  expression?: string;
  vinPattern?: string;
  makes?: string[];
  colors?: string[];
  states?: string[];
  salvageYards?: string[];
  sources?: string[];
  yardTypes?: YardType[];
  minYear?: number;
  maxYear?: number;
  arrivalWindow?: ArrivalWindow;
  near?: SearchArea;
  sortBy?: string;
}

/** Writes the URL the search router would write for these saved criteria. */
export function buildSearchUrl(
  query: string | null,
  filters: SearchFilters,
): string {
  const expression = filters.expression !== undefined;
  const searchValue = filters.expression ?? filters.vinPattern ?? query ?? "";
  const vinPattern = expression ? null : getSearchableVinPattern(searchValue);
  const sort = filters.sortBy
    ? getSearchSortRouteKey(filters.sortBy)
    : undefined;
  return SearchUrl.format("/search", {
    arrivalWindow: filters.arrivalWindow,
    area: filters.near,
    radius: filters.near?.radiusMiles,
    query: vinPattern?.normalized ?? searchValue,
    expression,
    facets: {
      makes: filters.makes,
      colors: filters.colors,
      states: filters.states,
      yards: filters.salvageYards,
      sources: filters.sources,
    },
    // The router omits the full searchable range.
    minYear:
      filters.minYear && filters.minYear !== MINIMUM_SEARCHABLE_VEHICLE_YEAR
        ? filters.minYear
        : undefined,
    maxYear:
      filters.maxYear && filters.maxYear !== getMaximumSearchableVehicleYear()
        ? filters.maxYear
        : undefined,
    yardTypes: SearchYardSelection.effectiveTypes(
      SearchYardSelection.fromSaved(filters.yardTypes),
    ),
    sort,
  });
}
