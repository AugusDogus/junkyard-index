import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";
import type { SearchVehicle } from "~/lib/types";
import { ALGOLIA_INDEX_NAME, searchClient } from "~/lib/algolia-search";
import { isIngestionSource } from "~/lib/ingestion-source";
import { MAX_SEARCH_ALERT_PREVIEW_VEHICLES } from "~/lib/search-alert-data";
import { VinPattern } from "~/lib/vin-pattern";

export interface AlertFilters {
  vinPattern?: string;
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

// Indexed VIN tokens always use "<position>:<character>", so this cannot match.
const NO_MATCH_VIN_FILTER = 'vinPositionTokens:"__no_match__"';

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

  if (filters.vinPattern) {
    const parsedPattern = VinPattern.parse(filters.vinPattern);
    if (!parsedPattern.success) {
      return NO_MATCH_VIN_FILTER;
    }
    const vinClause = VinPattern.toAlgoliaFilter(parsedPattern.data);
    if (!vinClause) {
      return NO_MATCH_VIN_FILTER;
    }
    clauses.push(vinClause);
  }

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
    (filters.sources ?? []).filter(isIngestionSource),
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
): Promise<{
  fullCount: number;
  retrievedCount: number;
  vehicles: SearchVehicle[];
}> {
  const filtersString = buildAlertFiltersString(filters, lastCheckedAt);
  if (filtersString === NO_MATCH_VIN_FILTER) {
    return { fullCount: 0, retrievedCount: 0, vehicles: [] };
  }
  const hitsPerPage = 100;
  let page = 0;
  let fullCount = 0;
  let retrievedCount = 0;
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

    for (const hit of hits) {
      const vehicle = algoliaHitToSearchVehicle(hit);
      if (vehicle) {
        retrievedCount += 1;
        if (vehicles.length < MAX_SEARCH_ALERT_PREVIEW_VEHICLES) {
          vehicles.push(vehicle);
        }
      }
    }

    if (retrievedCount >= fullCount) {
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
    retrievedCount < fullCount
  ) {
    console.warn(
      `[algolia-alert-search] Retrieved ${retrievedCount} of ${fullCount} hits due to paginationLimitedTo=${paginationLimitedTo}.`,
    );
  }

  return {
    fullCount,
    retrievedCount,
    vehicles,
  };
}
