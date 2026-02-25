import type { Vehicle } from "~/lib/types";
import { ALGOLIA_INDEX_NAME, algoliaClient } from "~/lib/algolia";

export interface AlertFilters {
  makes?: string[];
  colors?: string[];
  states?: string[];
  salvageYards?: string[];
  sources?: string[];
  minYear?: number;
  maxYear?: number;
  sortBy?: string;
}

interface AlgoliaSearchResponse {
  hits?: Record<string, unknown>[];
  nbHits?: number;
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildStringOrFilter(attribute: string, values: string[]): string | null {
  if (values.length === 0) return null;
  const clauses = values.map(
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

  if (typeof filters.minYear === "number") {
    clauses.push(`year >= ${filters.minYear}`);
  }
  if (typeof filters.maxYear === "number") {
    clauses.push(`year <= ${filters.maxYear}`);
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

  const response = (await algoliaClient.searchSingleIndex({
    indexName: ALGOLIA_INDEX_NAME,
    searchParams: {
      query: query.trim(),
      filters: filtersString,
      hitsPerPage: 100,
    },
  })) as AlgoliaSearchResponse;

  const hits = response.hits ?? [];
  return {
    fullCount: response.nbHits ?? 0,
    vehicles: hits.map(algoliaHitToVehicle),
  };
}
