import {
  sanitizeSearchSources,
  SEARCH_SORT_OPTIONS,
} from "~/components/search/search-routing";
import type { DataSource } from "~/lib/types";

export interface AdvancedSearchDraft {
  query: string;
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
  sources: DataSource[];
  yearRange: [number, number];
  sortBy: string;
}

interface AdvancedSearchYearLimits {
  min: number;
  max: number;
}

function readList(params: URLSearchParams, key: string): string[] {
  const value = params.get(key);
  return value ? [...new Set(value.split(",").filter(Boolean))] : [];
}

function readYear(
  params: URLSearchParams,
  key: "minYear" | "maxYear",
  fallback: number,
  limits: AdvancedSearchYearLimits,
): number {
  const value = params.get(key);
  if (!value) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, parsed));
}

export function readAdvancedSearchDraft(
  params: URLSearchParams,
  yearLimits: AdvancedSearchYearLimits,
): AdvancedSearchDraft {
  let minYear = readYear(params, "minYear", yearLimits.min, yearLimits);
  let maxYear = readYear(params, "maxYear", yearLimits.max, yearLimits);
  if (minYear > maxYear) [minYear, maxYear] = [maxYear, minYear];

  const requestedSort = params.get("sort") ?? "newest";
  const sortBy = SEARCH_SORT_OPTIONS.some(
    (option) => option.key === requestedSort,
  )
    ? requestedSort
    : "newest";

  return {
    query: params.get("q") ?? "",
    makes: readList(params, "makes"),
    colors: readList(params, "colors"),
    states: readList(params, "states"),
    salvageYards: readList(params, "yards"),
    sources: sanitizeSearchSources(readList(params, "sources")),
    yearRange: [minYear, maxYear],
    sortBy,
  };
}

function writeList(params: URLSearchParams, key: string, values: string[]) {
  const normalized = [...new Set(values.map((value) => value.trim()))].filter(
    Boolean,
  );
  if (normalized.length > 0) params.set(key, normalized.join(","));
}

export function buildAdvancedSearchUrl(
  draft: AdvancedSearchDraft,
  yearLimits: AdvancedSearchYearLimits,
  allowAdvancedFilters: boolean,
): string {
  const params = new URLSearchParams();
  const query = draft.query.trim();
  if (query) params.set("q", query);

  if (allowAdvancedFilters) {
    writeList(params, "makes", draft.makes);
    writeList(params, "colors", draft.colors);
    writeList(params, "states", draft.states);
    writeList(params, "yards", draft.salvageYards);
    writeList(params, "sources", draft.sources);
    if (draft.yearRange[0] !== yearLimits.min) {
      params.set("minYear", String(draft.yearRange[0]));
    }
    if (draft.yearRange[1] !== yearLimits.max) {
      params.set("maxYear", String(draft.yearRange[1]));
    }
  }

  if (draft.sortBy !== "newest") params.set("sort", draft.sortBy);

  const queryString = params.toString();
  return queryString ? `/search?${queryString}` : "/search";
}
