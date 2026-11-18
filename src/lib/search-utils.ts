import { SearchFilterUrl } from "~/lib/search-filter-url";
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
  sortBy?: string;
}

export function buildSearchUrl(
  query: string | null,
  filters: SearchFilters,
): string {
  const params = new URLSearchParams();

  if (filters.expression !== undefined) params.set("syntax", "expression");
  const searchValue = filters.expression ?? filters.vinPattern ?? query;
  if (searchValue) {
    params.set("q", searchValue);
  }

  if (filters.makes && filters.makes.length > 0) {
    SearchFilterUrl.write(params, "makes", filters.makes);
  }
  if (filters.colors && filters.colors.length > 0) {
    SearchFilterUrl.write(params, "colors", filters.colors);
  }
  if (filters.states && filters.states.length > 0) {
    SearchFilterUrl.write(params, "states", filters.states);
  }
  if (filters.salvageYards && filters.salvageYards.length > 0) {
    SearchFilterUrl.write(params, "yards", filters.salvageYards);
  }
  if (filters.sources && filters.sources.length > 0) {
    SearchFilterUrl.write(params, "sources", filters.sources);
  }
  if (filters.yardTypes?.length)
    SearchFilterUrl.write(params, "yardTypes", filters.yardTypes);
  if (filters.minYear) {
    params.set("minYear", filters.minYear.toString());
  }
  if (filters.maxYear) {
    params.set("maxYear", filters.maxYear.toString());
  }
  if (filters.sortBy) {
    params.set("sort", filters.sortBy);
  }

  const queryString = params.toString();
  return queryString ? `/search?${queryString}` : "/search";
}
