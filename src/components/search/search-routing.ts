import {
  ALGOLIA_INDEX_NAME,
  ALGOLIA_REPLICA_INDEX_NAMES,
} from "~/lib/constants";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
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
  return values.filter(
    (value): value is DataSource =>
      typeof value === "string" &&
      INGESTION_SOURCES.some((source) => source === value),
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

/** Maps stable, human-readable search URLs to Algolia's index UI state. */
export function createSearchRouting(
  indexName: string,
  vinPatternIndexReady: boolean,
) {
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

        const state = routeState[indexName];
        if (!state) {
          const queryString = params.toString();
          return queryString ? `${baseUrl}?${queryString}` : baseUrl;
        }

        if (state.query && !vinPattern) {
          params.set("q", String(state.query));
        }
        if (Array.isArray(state.makes)) {
          params.set("makes", state.makes.join(","));
        }
        if (Array.isArray(state.colors)) {
          params.set("colors", state.colors.join(","));
        }
        if (Array.isArray(state.states)) {
          params.set("states", state.states.join(","));
        }
        if (Array.isArray(state.yards)) {
          params.set("yards", state.yards.join(","));
        }
        if (Array.isArray(state.sources)) {
          params.set("sources", state.sources.join(","));
        }
        if (state.minYear) params.set("minYear", String(state.minYear));
        if (state.maxYear) params.set("maxYear", String(state.maxYear));
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

        for (const key of ["makes", "colors", "states", "yards", "sources"]) {
          const value = params.get(key);
          if (value) state[key] = value.split(",").filter(Boolean);
        }

        for (const key of ["minYear", "maxYear"]) {
          const value = params.get(key);
          if (!value) continue;
          const parsed = Number.parseInt(value, 10);
          if (!Number.isNaN(parsed)) state[key] = parsed;
        }

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

        const refinementList = indexState.refinementList;
        if (isUnknownRecord(refinementList)) {
          const refinements = refinementList;
          if (Array.isArray(refinements.make) && refinements.make.length > 0) {
            state.makes = refinements.make;
          }
          if (
            Array.isArray(refinements.color) &&
            refinements.color.length > 0
          ) {
            state.colors = refinements.color;
          }
          if (
            Array.isArray(refinements.state) &&
            refinements.state.length > 0
          ) {
            state.states = refinements.state;
          }
          if (
            Array.isArray(refinements.locationName) &&
            refinements.locationName.length > 0
          ) {
            state.yards = refinements.locationName;
          }
          if (
            Array.isArray(refinements.source) &&
            refinements.source.length > 0
          ) {
            state.sources = refinements.source;
          }
        }

        const range = indexState.range;
        if (isUnknownRecord(range)) {
          const year = range.year;
          if (typeof year === "string") {
            const [min, max] = year.split(":");
            if (min) {
              const parsed = Number.parseInt(min, 10);
              if (!Number.isNaN(parsed)) state.minYear = parsed;
            }
            if (max) {
              const parsed = Number.parseInt(max, 10);
              if (!Number.isNaN(parsed)) state.maxYear = parsed;
            }
          }
        }

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

        const refinementList: Record<string, string[]> = {};
        for (const [routeKey, refinementKey] of [
          ["makes", "make"],
          ["colors", "color"],
          ["states", "state"],
          ["yards", "locationName"],
        ] as const) {
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

        return { [indexName]: uiState };
      },
    },
  };
}
