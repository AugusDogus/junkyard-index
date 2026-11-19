import { ArrivalWindow } from "~/lib/arrival-window";
import { SearchArea } from "~/lib/search-area";
import { SearchYardSelection } from "~/lib/search-yard-selection";
import { SearchRadius } from "~/lib/search-radius";
import { YardService, type YardType } from "~/lib/yard-service";
import {
  ALGOLIA_DISTANCE_SORT_ALIAS,
  ALGOLIA_INDEX_NAME,
  ALGOLIA_NEWEST_INDEX_NAME,
  ALGOLIA_REPLICA_INDEX_NAMES,
} from "~/lib/constants";
import { isIngestionSource } from "~/lib/ingestion-source";
import type { DataSource } from "~/lib/types";
import { SearchFilterUrl } from "~/lib/search-filter-url";
import { VinPattern } from "~/lib/vin-pattern";

export const SEARCH_SORT_OPTIONS: readonly {
  indexName: string;
  key: string;
  label: string;
}[] = [
  {
    indexName: ALGOLIA_NEWEST_INDEX_NAME,
    key: "newest",
    label: "Newest First",
  },
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
  { indexName: ALGOLIA_INDEX_NAME, key: "relevance", label: "Relevance" },
  {
    indexName: ALGOLIA_DISTANCE_SORT_ALIAS,
    key: "distance",
    label: "Distance (Nearest)",
  },
];

export const MINIMUM_SEARCHABLE_VEHICLE_YEAR = 1900;

export function getMaximumSearchableVehicleYear(): number {
  return new Date().getUTCFullYear() + 1;
}

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
  return KEY_TO_INDEX[key] ?? ALGOLIA_NEWEST_INDEX_NAME;
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

// One draft per browser window, shared by the input and its routed search.
// Keep the starting URL so submitting a live preview preserves the last search.
type InputHistory =
  | { kind: "typing"; previous: string }
  | { kind: "submitting"; previous: string };
const inputHistory = new WeakMap<Window, InputHistory>();

function pushSubmittedSearch(previous: string, url: string) {
  if (previous === url) {
    window.history.replaceState(window.history.state, "", url);
    return;
  }
  window.history.replaceState(window.history.state, "", previous);
  window.history.pushState(window.history.state, "", url);
}

export const SearchInputHistory = {
  begin() {
    if (!inputHistory.has(window)) {
      inputHistory.set(window, {
        kind: "typing",
        previous: window.location.href,
      });
    }
  },
  cancel() {
    inputHistory.delete(window);
  },
  submit(query: string) {
    const draft = inputHistory.get(window);
    if ((new URL(window.location.href).searchParams.get("q") ?? "") !== query) {
      // An immediate submit can beat the router's pending write. Let that write
      // create the checkpoint using the final URL, rather than a partial query.
      inputHistory.set(window, {
        kind: "submitting",
        previous: draft?.previous ?? window.location.href,
      });
      return;
    }
    inputHistory.delete(window);
    if (draft) pushSubmittedSearch(draft.previous, window.location.href);
  },
  write(url: string, navigationKey: (url: string) => string) {
    const draft = inputHistory.get(window);
    if (draft?.kind === "submitting") {
      inputHistory.delete(window);
      pushSubmittedSearch(draft.previous, url);
    } else if (
      draft?.kind === "typing" &&
      navigationKey(url) === navigationKey(window.location.href)
    ) {
      window.history.replaceState(window.history.state, "", url);
    } else {
      inputHistory.delete(window);
      window.history.pushState(window.history.state, "", url);
    }
  },
} as const;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sanitizeYardTypes(values: unknown): YardType[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values.flatMap((value: unknown) => {
        const type = YardService.parseType(value);
        return type ? [type] : [];
      }),
    ),
  ];
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
] as const;

interface AdvancedRouteFilters {
  makes?: string[];
  colors?: string[];
  states?: string[];
  yards?: string[];
  sources?: DataSource[];
  yardTypes?: (YardType | "all")[];
  minYear?: number;
  maxYear?: number;
  arrivalWindow?: ArrivalWindow;
}

interface AdvancedUiFilters {
  refinementList?: Record<string, string[]>;
  range?: { year: string };
}

function parseAdvancedUrlFilters(
  params: URLSearchParams,
  knownYardNames: readonly string[],
): AdvancedRouteFilters {
  const filters: AdvancedRouteFilters = {};
  filters.arrivalWindow = ArrivalWindow.fromUrl(params);
  for (const key of ["makes", "colors", "states", "yards"] as const) {
    const values = SearchFilterUrl.read(
      params,
      key,
      key === "yards" ? knownYardNames : [],
    );
    if (values.length) Object.assign(filters, { [key]: values });
  }
  const sources = sanitizeSearchSources(
    SearchFilterUrl.read(params, "sources"),
  );
  if (sources.length > 0) filters.sources = sources;
  const selection = SearchYardSelection.fromUrl(params);
  if (selection.kind !== "default") {
    const types = SearchYardSelection.effectiveTypes(selection);
    filters.yardTypes = types.length ? types : ["all"];
  }
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
      SearchFilterUrl.write(
        params,
        key,
        value.filter((item): item is string => typeof item === "string"),
      );
      continue;
    }
    if (typeof value === "number") {
      params.set(key, String(value));
      continue;
    }
    for (const paramKey of [key, `${key}[]`]) {
      for (const fallbackValue of fallback?.getAll(paramKey) ?? []) {
        params.append(paramKey, fallbackValue);
      }
    }
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
    const yardTypes = sanitizeYardTypes(refinementList.yardTypes);
    if (yardTypes.length) route.yardTypes = yardTypes;
  }

  const range = indexState.range;
  if (isUnknownRecord(range) && typeof range.year === "string") {
    const [min, max] = range.year.split(":");
    const minYear = min ? Number.parseInt(min, 10) : Number.NaN;
    const maxYear = max ? Number.parseInt(max, 10) : Number.NaN;
    if (!Number.isNaN(minYear) && minYear !== MINIMUM_SEARCHABLE_VEHICLE_YEAR) {
      route.minYear = minYear;
    }
    if (
      !Number.isNaN(maxYear) &&
      maxYear !== getMaximumSearchableVehicleYear()
    ) {
      route.maxYear = maxYear;
    }
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
        toUiState: (state) =>
          ArrivalWindow.parse(state.arrivalWindow)
            ? advancedUiStateFromRoute({
                states: state.states,
                yards: state.yards,
                sources: state.sources,
              })
            : {},
      };
}

/** Maps stable, human-readable search URLs to Algolia's index UI state. */
export function createSearchRouting(
  indexName: string,
  vinPatternIndexReady: boolean,
  allowAdvancedFilters: boolean,
  {
    knownYardNames = [],
    newestSortReady = true,
  }: {
    knownYardNames?: readonly string[];
    newestSortReady?: boolean;
  } = {},
) {
  const advancedFilterPolicy = createAdvancedFilterPolicy(allowAdvancedFilters);
  const defaultSortIndex = newestSortReady
    ? ALGOLIA_NEWEST_INDEX_NAME
    : ALGOLIA_INDEX_NAME;
  const routing = {
    router: {
      cleanUrlOnDispose: false,
      // The input already debounces. Reset native history navigation before
      // another user action can replace its pending URL write.
      writeDelay: 0,
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
        const arrivalWindow = ArrivalWindow.fromUrl(locationParams);
        if (arrivalWindow)
          SearchFilterUrl.write(params, "arrivalWindow", [arrivalWindow]);
        const area = SearchArea.fromUrl(locationParams);
        if (area) {
          params.set("lat", String(area.lat));
          params.set("lng", String(area.lng));
        }
        const radius = SearchRadius.parse(locationParams.get("radius"));
        if (radius !== null) params.set("radius", String(radius));
        const vinPattern =
          vinPatternIndexReady && locationParams.get("syntax") !== "expression"
            ? getSearchableVinPattern(locationParams.get("q"))
            : null;
        if (vinPattern) params.set("q", vinPattern.normalized);

        const state = routeState[indexName] ?? {};

        if (state.query && !vinPattern) {
          params.set("q", String(state.query));
        }
        if (params.has("q") && locationParams.get("syntax") === "expression")
          params.set("syntax", "expression");
        const lockedFallback = new URLSearchParams(locationParams);
        if (arrivalWindow)
          for (const key of ["states", "yards", "sources"]) {
            lockedFallback.delete(key);
            lockedFallback.delete(`${key}[]`);
          }
        writeAdvancedUrlFilters(
          params,
          state,
          advancedFilterPolicy.preserveUrlFilters ? lockedFallback : undefined,
        );
        for (const key of ["minYear", "maxYear"] as const) {
          if (typeof state[key] === "number")
            params.set(key, String(state[key]));
        }
        if (Array.isArray(state.yardTypes) && state.yardTypes.length) {
          SearchFilterUrl.write(
            params,
            "yardTypes",
            state.yardTypes.filter(
              (value): value is string => typeof value === "string",
            ),
          );
        }
        if (state.sort) params.set("sort", String(state.sort));

        const queryString = params.toString();
        return queryString ? `${baseUrl}?${queryString}` : baseUrl;
      },
      parseURL({ location }: { location: SearchLocation }) {
        const params = new URLSearchParams(location.search);
        const state: Record<string, unknown> = {};

        const query = params.get("q");
        const vinPattern =
          vinPatternIndexReady && params.get("syntax") !== "expression"
            ? getSearchableVinPattern(query)
            : null;
        if (query && !vinPattern) state.query = query;

        Object.assign(state, parseAdvancedUrlFilters(params, knownYardNames));

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
        // The sort widget omits sortBy for its primary index, which is Relevance.
        const sortBy = String(indexState.sortBy ?? indexName);
        if (sortBy !== defaultSortIndex) {
          state.sort = INDEX_TO_KEY[sortBy] ?? sortBy;
        }

        Object.assign(state, advancedRouteFromUiState(indexState));
        if (!state.yardTypes) state.yardTypes = ["all"];

        return { [indexName]: state };
      },
      routeToState(routeState: SearchState) {
        const state = routeState[indexName] ?? {};
        const uiState: Record<string, unknown> = {};

        if (state.query) uiState.query = state.query;
        const sort = String(
          state.sort ?? (newestSortReady ? "newest" : "relevance"),
        );
        const mapped = KEY_TO_INDEX[sort] ?? sort;
        uiState.sortBy =
          !KNOWN_SORT_INDICES.has(mapped) ||
          (!newestSortReady && mapped === ALGOLIA_NEWEST_INDEX_NAME)
            ? defaultSortIndex
            : mapped;

        Object.assign(uiState, advancedFilterPolicy.toUiState(state));
        // Year bounds are free even when the other routed refinements are locked.
        if (state.minYear || state.maxYear) {
          uiState.range = {
            year: `${state.minYear ?? ""}:${state.maxYear ?? ""}`,
          };
        }
        const types =
          Array.isArray(state.yardTypes) && state.yardTypes.includes("all")
            ? []
            : Array.isArray(state.yardTypes)
              ? sanitizeYardTypes(state.yardTypes)
              : ["self_service"];
        uiState.refinementList = {
          ...(isUnknownRecord(uiState.refinementList)
            ? uiState.refinementList
            : {}),
          yardTypes: types,
        };

        return { [indexName]: uiState };
      },
    },
  };
  return {
    ...routing,
    router: {
      ...routing.router,
      push(url: string) {
        SearchInputHistory.write(url, (href) => {
          const location = new URL(href);
          // Query expressions can themselves select yard types. Exclude the
          // query before parsing so those edits are still treated as typing.
          location.searchParams.delete("q");
          const state = routing.stateMapping.routeToState(
            routing.router.parseURL({ location }),
          );
          return JSON.stringify(state);
        });
      },
    },
  };
}
