import {
  ALGOLIA_INDEX_NAME,
  ALGOLIA_REPLICA_INDEX_NAMES,
} from "~/lib/constants";
import { isIngestionSource } from "~/lib/ingestion-source";
import type { DataSource } from "~/lib/types";
import { VinPattern } from "~/lib/vin-pattern";

export const SEARCH_SORT_OPTIONS: readonly {
  indexName: string;
  key: string;
  label: string;
}[] = [
  { indexName: ALGOLIA_INDEX_NAME, key: "newest", label: "Newest First" },
  {
    indexName: ALGOLIA_REPLICA_INDEX_NAMES[0],
    key: "oldest",
    label: "Oldest First",
  },
  {
    indexName: ALGOLIA_REPLICA_INDEX_NAMES[1],
    key: "year-desc",
    label: "Year (High to Low)",
  },
  {
    indexName: ALGOLIA_REPLICA_INDEX_NAMES[2],
    key: "year-asc",
    label: "Year (Low to High)",
  },
  {
    indexName: ALGOLIA_REPLICA_INDEX_NAMES[3],
    key: "distance",
    label: "Distance (Nearest)",
  },
];

export const SEARCH_SORT_ITEMS = SEARCH_SORT_OPTIONS.map(
  ({ indexName, label }) => ({ value: indexName, label }),
);

const INDEX_TO_KEY = Object.fromEntries(
  SEARCH_SORT_OPTIONS.map((option) => [option.indexName, option.key]),
);
const KEY_TO_INDEX = Object.fromEntries(
  SEARCH_SORT_OPTIONS.map((option) => [option.key, option.indexName]),
);
const KNOWN_SORT_INDICES = new Set(
  SEARCH_SORT_OPTIONS.map((option) => option.indexName),
);

export function getSearchSortKey(indexName: string): string {
  return INDEX_TO_KEY[indexName] ?? "newest";
}

export function getSearchSortIndex(key: string): string {
  return KEY_TO_INDEX[key] ?? ALGOLIA_INDEX_NAME;
}
export function sanitizeSearchSources(values: unknown): DataSource[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is DataSource =>
    isIngestionSource(value),
  );
}

export function getSearchableVinPattern(value: string | null): {
  normalized: string;
  filter: string;
} | null {
  if (!value) return null;

  const parsed = VinPattern.parse(value);
  if (!parsed.success) return null;

  const filter = VinPattern.toAlgoliaFilter(parsed.data);
  if (!filter) return null;

  return { normalized: parsed.data.normalized, filter };
}

interface SearchLocation {
  href: string;
  search: string;
}

type SearchState = Record<string, Record<string, unknown>>;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ADVANCED_REFINEMENTS = [
  { routeKey: "makes", refinementKey: "make" },
  { routeKey: "colors", refinementKey: "color" },
  { routeKey: "states", refinementKey: "state" },
  { routeKey: "yards", refinementKey: "locationName" },
] as const;

const ADVANCED_URL_KEYS = [
  "makes",
  "colors",
  "states",
  "yards",
  "sources",
  "minYear",
  "maxYear",
] as const;

interface AdvancedRouteFilters {
  makes?: string[];
  colors?: string[];
  states?: string[];
  yards?: string[];
  sources?: DataSource[];
  minYear?: number;
  maxYear?: number;
}

interface AdvancedUiFilters {
  refinementList?: Record<string, string[]>;
  range?: { year: string };
}

function parseAdvancedUrlFilters(
  params: URLSearchParams,
): AdvancedRouteFilters {
  const filters: AdvancedRouteFilters = {};
  for (const key of ["makes", "colors", "states", "yards"] as const) {
    const value = params.get(key);
    if (value) {
      Object.assign(filters, { [key]: value.split(",").filter(Boolean) });
    }
  }
  const sources = sanitizeSearchSources(params.get("sources")?.split(","));
  if (sources.length > 0) filters.sources = sources;
  for (const key of ["minYear", "maxYear"] as const) {
    const value = params.get(key);
    if (!value) continue;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) Object.assign(filters, { [key]: parsed });
  }
  return filters;
}

function writeAdvancedUrlFilters(
  params: URLSearchParams,
  state: Record<string, unknown>,
  fallback?: URLSearchParams,
): void {
  for (const key of ADVANCED_URL_KEYS) {
    const value = state[key];
    if (Array.isArray(value) && value.length > 0) {
      params.set(key, value.join(","));
      continue;
    }
    if (typeof value === "number") {
      params.set(key, String(value));
      continue;
    }
    const fallbackValue = fallback?.get(key);
    if (fallbackValue) params.set(key, fallbackValue);
  }
}

function advancedRouteFromUiState(
  indexState: Record<string, unknown>,
): AdvancedRouteFilters {
  const route: AdvancedRouteFilters = {};
  const refinementList = indexState.refinementList;
  if (isUnknownRecord(refinementList)) {
    for (const { routeKey, refinementKey } of ADVANCED_REFINEMENTS) {
      const values = refinementList[refinementKey];
      if (Array.isArray(values)) {
        const strings = values.filter(
          (value): value is string => typeof value === "string",
        );
        if (strings.length > 0) Object.assign(route, { [routeKey]: strings });
      }
    }
    const sources = sanitizeSearchSources(refinementList.source);
    if (sources.length > 0) route.sources = sources;
  }

  const range = indexState.range;
  if (isUnknownRecord(range) && typeof range.year === "string") {
    const [min, max] = range.year.split(":");
    const minYear = min ? Number.parseInt(min, 10) : Number.NaN;
    const maxYear = max ? Number.parseInt(max, 10) : Number.NaN;
    if (!Number.isNaN(minYear)) route.minYear = minYear;
    if (!Number.isNaN(maxYear)) route.maxYear = maxYear;
  }
  return route;
}

function advancedUiStateFromRoute(
  state: Record<string, unknown>,
): AdvancedUiFilters {
  const uiState: AdvancedUiFilters = {};
  const refinementList: Record<string, string[]> = {};
  for (const { routeKey, refinementKey } of ADVANCED_REFINEMENTS) {
    const values = state[routeKey];
    if (Array.isArray(values)) {
      refinementList[refinementKey] = values.filter(
        (value): value is string => typeof value === "string",
      );
    }
  }
  const sources = sanitizeSearchSources(state.sources);
  if (sources.length > 0) refinementList.source = sources;
  if (Object.keys(refinementList).length > 0) {
    uiState.refinementList = refinementList;
  }
  if (state.minYear || state.maxYear) {
    uiState.range = {
      year: `${state.minYear ?? ""}:${state.maxYear ?? ""}`,
    };
  }
  return uiState;
}

interface AdvancedFilterPolicy {
  preserveUrlFilters: boolean;
  toUiState(state: Record<string, unknown>): AdvancedUiFilters;
}

function createAdvancedFilterPolicy(allowed: boolean): AdvancedFilterPolicy {
  return allowed
    ? {
        preserveUrlFilters: false,
        toUiState: advancedUiStateFromRoute,
      }
    : {
        preserveUrlFilters: true,
        toUiState: () => ({}),
      };
}

/** Maps stable, human-readable search URLs to Algolia's index UI state. */
export function createSearchRouting(
  indexName: string,
  vinPatternIndexReady: boolean,
  allowAdvancedFilters: boolean = true,
) {
  const advancedFilterPolicy = createAdvancedFilterPolicy(allowAdvancedFilters);
  return {
    router: {
      cleanUrlOnDispose: false,
      createURL({
        routeState,
        location,
      }: {
        routeState: SearchState;
        location: SearchLocation;
      }): string {
        const baseUrl = location.href.split("?")[0] ?? location.href;
        const params = new URLSearchParams();
        const locationParams = new URLSearchParams(location.search);
        const vinPattern = vinPatternIndexReady
          ? getSearchableVinPattern(locationParams.get("q"))
          : null;
        if (vinPattern) params.set("q", vinPattern.normalized);

        const state = routeState[indexName] ?? {};

        if (state.query && !vinPattern) {
          params.set("q", String(state.query));
        }
        writeAdvancedUrlFilters(
          params,
          state,
          advancedFilterPolicy.preserveUrlFilters ? locationParams : undefined,
        );
        if (state.sort) params.set("sort", String(state.sort));

        const queryString = params.toString();
        return queryString ? `${baseUrl}?${queryString}` : baseUrl;
      },
      parseURL({ location }: { location: SearchLocation }) {
        const params = new URLSearchParams(location.search);
        const state: Record<string, unknown> = {};

        const query = params.get("q");
        const vinPattern = vinPatternIndexReady
          ? getSearchableVinPattern(query)
          : null;
        if (query && !vinPattern) state.query = query;

        Object.assign(state, parseAdvancedUrlFilters(params));

        const sort = params.get("sort");
        if (sort) state.sort = sort;

        return { [indexName]: state };
      },
    },
    stateMapping: {
      stateToRoute(uiState: SearchState) {
        const indexState = uiState[indexName] ?? {};
        const state: Record<string, unknown> = {};

        if (indexState.query) state.query = indexState.query;
        if (indexState.sortBy && indexState.sortBy !== indexName) {
          const sortBy = String(indexState.sortBy);
          state.sort = INDEX_TO_KEY[sortBy] ?? sortBy;
        }

        Object.assign(state, advancedRouteFromUiState(indexState));

        return { [indexName]: state };
      },
      routeToState(routeState: SearchState) {
        const state = routeState[indexName] ?? {};
        const uiState: Record<string, unknown> = {};

        if (state.query) uiState.query = state.query;
        if (state.sort) {
          const sort = String(state.sort);
          const mapped = KEY_TO_INDEX[sort] ?? sort;
          if (KNOWN_SORT_INDICES.has(mapped)) uiState.sortBy = mapped;
        }

        Object.assign(uiState, advancedFilterPolicy.toUiState(state));

        return { [indexName]: uiState };
      },
    },
  };
}
