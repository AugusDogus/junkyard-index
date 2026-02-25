import type { Vehicle } from "~/lib/types";
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
    (filters.sources ?? []).filter((s) => s === "pyp" || s === "row52"),
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

export function algoliaHitToVehicle(hit: Record<string, unknown>): Vehicle {
  const geoloc = hit._geoloc as { lat: number; lng: number } | undefined;
  const hitLat = geoloc?.lat ?? 0;
  const hitLng = geoloc?.lng ?? 0;

  return {
    id: (hit.objectID as string) ?? (hit.vin as string) ?? "",
    year: (hit.year as number) ?? 0,
    make: (hit.make as string) ?? "",
    model: (hit.model as string) ?? "",
    color: (hit.color as string) ?? "",
    vin: (hit.vin as string) ?? (hit.objectID as string) ?? "",
    stockNumber: (hit.stockNumber as string) ?? "",
    availableDate: (hit.availableDate as string) ?? "",
    source: (hit.source as "pyp" | "row52") ?? "pyp",
    location: {
      locationCode: (hit.locationCode as string) ?? "",
      locationPageURL: "",
      name: (hit.locationName as string) ?? "",
      displayName: ((hit.locationName as string) ?? "")
        .replace(/^Pick Your Part - /, "")
        .replace(/^PICK-n-PULL /, "")
        .replace(/^LKQ Pull-A-Part - /, ""),
      address: "",
      city: "",
      state: (hit.state as string) ?? "",
      stateAbbr: (hit.stateAbbr as string) ?? "",
      zip: "",
      phone: "",
      lat: hitLat,
      lng: hitLng,
      distance: 0,
      legacyCode: "",
      primo: "",
      source: (hit.source as "pyp" | "row52") ?? "pyp",
      urls: {
        store: "",
        interchange: "",
        inventory: "",
        prices: (hit.pricesUrl as string) ?? "",
        directions: "",
        sellACar: "",
        contact: "",
        customerServiceChat: null,
        carbuyChat: null,
        deals: "",
        parts: (hit.partsUrl as string) ?? "",
      },
    },
    yardLocation: {
      section: (hit.section as string) ?? "",
      row: (hit.row as string) ?? "",
      space: (hit.space as string) ?? "",
    },
    images: (hit.imageUrl as string) ? [{ url: hit.imageUrl as string }] : [],
    detailsUrl: (hit.detailsUrl as string) ?? "",
    partsUrl: (hit.partsUrl as string) ?? "",
    pricesUrl: (hit.pricesUrl as string) ?? "",
    engine: (hit.engine as string) ?? undefined,
    trim: (hit.trim as string) ?? undefined,
    transmission: (hit.transmission as string) ?? undefined,
  };
}

export async function getAlertMatchStats(
  query: string,
  filters: AlertFilters,
  lastCheckedAt: Date | null,
): Promise<{ fullCount: number; vehicles: Vehicle[] }> {
  const filtersString = buildAlertFiltersString(filters, lastCheckedAt);
  const hitsPerPage = 100;
  let page = 0;
  let fullCount = 0;
  const vehicles: Vehicle[] = [];

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
    }
    if (hits.length === 0) {
      break;
    }

    vehicles.push(...hits.map(algoliaHitToVehicle));

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

  return {
    fullCount,
    vehicles,
  };
}
