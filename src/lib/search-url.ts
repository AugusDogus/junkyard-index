import type { ArrivalWindow } from "./arrival-window";
import { SearchFilterUrl } from "./search-filter-url";
import { SearchYardSelection } from "./search-yard-selection";
import type { YardType } from "./yard-service";

const FACET_KEYS = ["makes", "colors", "states", "yards", "sources"] as const;
type SearchUrlFacet = (typeof FACET_KEYS)[number];

/** A search, already reduced to the values its URL keeps. */
export interface SearchUrl {
  query?: string;
  expression?: boolean;
  arrivalWindow?: ArrivalWindow;
  area?: { lat: number; lng: number };
  radius?: number;
  facets?: Partial<Record<SearchUrlFacet, readonly string[]>>;
  minYear?: number;
  maxYear?: number;
  /** Omitted writes nothing. Empty means every yard type. */
  yardTypes?: readonly YardType[];
  /** A non-default sort key. */
  sort?: string;
}

/**
 * The one writer of search URLs. The router and links that open a search
 * (such as saved searches) must agree byte for byte, or the router rewrites
 * the URL after navigation. `locked` supplies raw facet params to keep for a
 * viewer who cannot edit them; a facet in `url.facets` replaces them.
 */
function format(
  pathname: string,
  url: SearchUrl,
  locked?: URLSearchParams,
): string {
  const params = new URLSearchParams();
  if (url.arrivalWindow)
    SearchFilterUrl.write(params, "arrivalWindow", [url.arrivalWindow]);
  if (url.area) {
    params.set("lat", String(url.area.lat));
    params.set("lng", String(url.area.lng));
  }
  if (url.radius !== undefined) params.set("radius", String(url.radius));
  if (url.query) {
    params.set("q", url.query);
    if (url.expression) params.set("syntax", "expression");
  }
  for (const key of FACET_KEYS) {
    const values = url.facets?.[key];
    if (values) {
      SearchFilterUrl.write(params, key, values.filter(Boolean));
      continue;
    }
    for (const paramKey of [key, `${key}[]`]) {
      for (const value of locked?.getAll(paramKey) ?? []) {
        params.append(paramKey, value);
      }
    }
  }
  if (url.minYear !== undefined) params.set("minYear", String(url.minYear));
  if (url.maxYear !== undefined) params.set("maxYear", String(url.maxYear));
  // Only a non-default yard scope is written. `all` stays explicit so a reload
  // cannot reapply the self-service default.
  if (url.yardTypes && !SearchYardSelection.isImplied(params, url.yardTypes))
    SearchFilterUrl.write(
      params,
      "yardTypes",
      url.yardTypes.length ? url.yardTypes : ["all"],
    );
  if (url.sort) params.set("sort", url.sort);

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

export const SearchUrl = { facets: FACET_KEYS, format } as const;
