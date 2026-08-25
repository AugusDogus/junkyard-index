import type { SearchResponse } from "algoliasearch/lite";
import {
  algoliaHitToSearchVehicle,
  type AlgoliaVehicleHit,
} from "~/lib/search-vehicles";
import type { SearchVehicle } from "~/lib/types";
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

export interface AlertSearchPage {
  hits: ReadonlyArray<AlgoliaVehicleHit>;
  reportedCount: number;
  reportedPageCount: number;
  countIsExhaustive: boolean;
}

export type AlertScanCompletion =
  | { status: "complete" }
  | { status: "incomplete"; reason: "missing-page" | "pagination-limit" };

export interface AlertMatchStats {
  matchedCount: number;
  completion: AlertScanCompletion;
  vehicles: SearchVehicle[];
}

interface AlertScanConfig {
  hitsPerPage: number;
  paginationLimit: number;
}

export type FetchAlertSearchPage = (
  page: number,
  hitsPerPage: number,
) => Promise<AlertSearchPage | null>;

export function toAlertSearchPage(
  result: SearchResponse<AlgoliaVehicleHit>,
): AlertSearchPage {
  const countIsExhaustive =
    (result.exhaustive?.nbHits ?? result.exhaustiveNbHits ?? false) &&
    result.nbHits !== undefined &&
    result.nbPages !== undefined;

  return {
    hits: result.hits,
    reportedCount: result.nbHits ?? result.hits.length,
    reportedPageCount: result.nbPages ?? 0,
    countIsExhaustive,
  };
}

export type AlertFilterCompilation =
  | { kind: "no_match" }
  | { kind: "filter"; value: string | undefined };

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
  const firstClause = clauses[0];
  if (firstClause === undefined) return null;
  return clauses.length === 1 ? firstClause : `(${clauses.join(" OR ")})`;
}

export function compileAlertFilters(
  filters: AlertFilters,
  lastCheckedAt: Date | null,
): AlertFilterCompilation {
  const clauses: string[] = [];

  if (filters.vinPattern) {
    const parsedPattern = VinPattern.parse(filters.vinPattern);
    if (!parsedPattern.success) {
      return { kind: "no_match" };
    }
    const vinClause = VinPattern.toAlgoliaFilter(parsedPattern.data);
    if (!vinClause) {
      return { kind: "no_match" };
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

  return {
    kind: "filter",
    value: clauses.length > 0 ? clauses.join(" AND ") : undefined,
  };
}

export async function scanAlertMatchPages(
  fetchPage: FetchAlertSearchPage,
  config: AlertScanConfig,
): Promise<AlertMatchStats> {
  let page = 0;
  let scannedCount = 0;
  let matchedCount = 0;
  const vehicles: SearchVehicle[] = [];

  while (true) {
    const result = await fetchPage(page, config.hitsPerPage);
    if (result === null) {
      return {
        matchedCount,
        completion: { status: "incomplete", reason: "missing-page" },
        vehicles,
      };
    }

    const { hits } = result;
    if (hits.length === 0) {
      return {
        matchedCount,
        completion: { status: "complete" },
        vehicles,
      };
    }

    for (const hit of hits) {
      scannedCount += 1;
      const vehicle = algoliaHitToSearchVehicle(hit);
      if (vehicle) {
        matchedCount += 1;
        if (vehicles.length < MAX_SEARCH_ALERT_PREVIEW_VEHICLES) {
          vehicles.push(vehicle);
        }
      }
    }

    const reachedPaginationLimit =
      scannedCount >= config.paginationLimit &&
      (!result.countIsExhaustive ||
        result.reportedCount > config.paginationLimit);
    if (reachedPaginationLimit) {
      console.warn(
        `[algolia-alert-search] Scan incomplete after ${scannedCount} hits (reported=${result.reportedCount}, paginationLimitedTo=${config.paginationLimit}).`,
      );
      return {
        matchedCount,
        completion: { status: "incomplete", reason: "pagination-limit" },
        vehicles,
      };
    }
    if (hits.length < config.hitsPerPage) {
      return {
        matchedCount,
        completion: { status: "complete" },
        vehicles,
      };
    }
    if (
      result.countIsExhaustive &&
      (page + 1 >= result.reportedPageCount ||
        scannedCount >= result.reportedCount)
    ) {
      return {
        matchedCount,
        completion: { status: "complete" },
        vehicles,
      };
    }

    page += 1;
  }
}
