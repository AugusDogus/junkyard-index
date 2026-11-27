import { YardService, type YardType } from "~/lib/yard-service";
import {
  ALGOLIA_DISTANCE_SORT_ALIAS,
  ALGOLIA_INDEX_NAME,
  ALGOLIA_NEWEST_INDEX_NAME,
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

export function getSearchSortKey(indexName: string): string {
  return INDEX_TO_KEY[indexName] ?? "newest";
}

export function getSearchSortIndex(key: string): string {
  return KEY_TO_INDEX[key] ?? ALGOLIA_NEWEST_INDEX_NAME;
}

/** The `sort` URL value for a stored key or index; undefined means newest. */
export function getSearchSortRouteKey(sort: string): string | undefined {
  const index = KEY_TO_INDEX[sort] ?? sort;
  return index === ALGOLIA_NEWEST_INDEX_NAME ? undefined : INDEX_TO_KEY[index];
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
