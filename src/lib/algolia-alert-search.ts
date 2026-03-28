import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";
import type { SearchVehicle } from "~/lib/types";
import { ALGOLIA_INDEX_NAME, searchClient } from "~/lib/algolia-search";

export interface AlertFilters {
  makes?: string[];
  colors?: string[];
  states?: string[];
  salvageYards?: string[];
  sources?: string[];
  minYear?: number;
  maxYear?: number;
}

interface AlgoliaSearchResponse {
  hits?: Record<string, unknown>[];
  nbHits?: number;
  nbPages?: number;
  paginationLimitedTo?: number;
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildStringOrFilter(
  attribute: string,
  values: string[],
): string | null {
  const cleanedValues = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (cleanedValues.length === 0) return null;
  const clauses = cleanedValues.map(
    (value) => `${attribute}:"${escapeFilterValue(value)}"`,
  );
  return clauses.length === 1 ? clauses[0]! : `(${clauses.join(" OR ")})`;
}

export function buildAlertFiltersString(
  filters: AlertFilters,
  lastCheckedAt: Date | null,
): string | undefined {
  const clauses: string[] = [];

  if (lastCheckedAt) {
    const lastCheckedAtSeconds = Math.floor(lastCheckedAt.getTime() / 1000);
    clauses.push(`firstSeenAt > ${lastCheckedAtSeconds}`);
  }

  const makesClause = buildStringOrFilter("make", filters.makes ?? []);
  if (makesClause) clauses.push(makesClause);

  const colorsClause = buildStringOrFilter("color", filters.colors ?? []);
  if (colorsClause) clauses.push(colorsClause);

  const statesClause = buildStringOrFilter("state", filters.states ?? []);
  if (statesClause) clauses.push(statesClause);

  const yardsClause = buildStringOrFilter(
    "locationName",
    filters.salvageYards ?? [],
  );
  if (yardsClause) clauses.push(yardsClause);

  const sourcesClause = buildStringOrFilter(
    "source",
    (filters.sources ?? []).filter(
      (s) => s === "pyp" || s === "row52" || s === "autorecycler",
    ),
  );
  if (sourcesClause) clauses.push(sourcesClause);

  let minYear = Number.isFinite(filters.minYear) ? filters.minYear : undefined;
  let maxYear = Number.isFinite(filters.maxYear) ? filters.maxYear : undefined;

  if (minYear !== undefined && maxYear !== undefined && minYear > maxYear) {
    [minYear, maxYear] = [maxYear, minYear];
  }

  if (minYear !== undefined) {
    clauses.push(`year >= ${minYear}`);
  }
  if (maxYear !== undefined) {
    clauses.push(`year <= ${maxYear}`);
  }

  return clauses.length > 0 ? clauses.join(" AND ") : undefined;
}

export async function getAlertMatchStats(
  query: string,
  filters: AlertFilters,
  lastCheckedAt: Date | null,
): Promise<{ fullCount: number; vehicles: SearchVehicle[] }> {
  const filtersString = buildAlertFiltersString(filters, lastCheckedAt);
  const hitsPerPage = 100;
  let page = 0;
  let fullCount = 0;
  let paginationLimitedTo: number | undefined;
  const vehicles: SearchVehicle[] = [];

  while (true) {
    const response = await searchClient.searchForHits<Record<string, unknown>>({
      requests: [
        {
          indexName: ALGOLIA_INDEX_NAME,
          query: query.trim(),
          filters: filtersString,
          hitsPerPage,
          page,
        },
      ],
    });
    const result = response.results[0] as AlgoliaSearchResponse | undefined;
    if (!result) {
      break;
    }

    const hits = result.hits ?? [];
    if (page === 0) {
      fullCount = result.nbHits ?? hits.length;
      paginationLimitedTo = result.paginationLimitedTo;
    }
    if (hits.length === 0) {
      break;
    }

    vehicles.push(...hits.map((hit) => algoliaHitToSearchVehicle(hit)));

    if (vehicles.length >= fullCount) {
      break;
    }
    if (hits.length < hitsPerPage) {
      break;
    }
    if (typeof result.nbPages === "number" && page + 1 >= result.nbPages) {
      break;
    }

    page += 1;
  }

  if (
    paginationLimitedTo !== undefined &&
    fullCount > paginationLimitedTo &&
    vehicles.length < fullCount
  ) {
    console.warn(
      `[algolia-alert-search] Retrieved ${vehicles.length} of ${fullCount} hits due to paginationLimitedTo=${paginationLimitedTo}.`,
    );
  }

  return {
    fullCount,
    vehicles,
  };
}
