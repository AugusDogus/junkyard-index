interface SearchFilters {
  makes?: string[];
  colors?: string[];
  states?: string[];
  salvageYards?: string[];
  minYear?: number;
  maxYear?: number;
  sortBy?: string;
}

export function buildSearchUrl(query: string | null, filters: SearchFilters): string {
  const params = new URLSearchParams();

  if (query) {
    params.set("q", query);
  }

  if (filters.makes && filters.makes.length > 0) {
    params.set("makes", filters.makes.join(","));
  }
  if (filters.colors && filters.colors.length > 0) {
    params.set("colors", filters.colors.join(","));
  }
  if (filters.states && filters.states.length > 0) {
    params.set("states", filters.states.join(","));
  }
  if (filters.salvageYards && filters.salvageYards.length > 0) {
    params.set("yards", filters.salvageYards.join(","));
  }
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
