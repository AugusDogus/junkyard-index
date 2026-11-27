import {
  createLoader,
  createParser,
  createSerializer,
  type inferParserType,
  type Nullable,
  parseAsFloat,
  parseAsInteger,
  parseAsNativeArrayOf,
  parseAsNumberLiteral,
  parseAsString,
  parseAsStringLiteral,
} from "nuqs/server";
import { ArrivalWindow } from "./arrival-window";
import { SearchArea } from "./search-area";
import { SearchFilterUrl } from "./search-filter-url";
import { SEARCH_RADIUS_MILES, type SearchRadiusMiles } from "./search-radius";
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
  radius?: SearchRadiusMiles;
  facets?: Partial<Record<SearchUrlFacet, readonly string[]>>;
  minYear?: number;
  maxYear?: number;
  /** Omitted writes nothing. Empty means every yard type. */
  yardTypes?: readonly YardType[];
  /** A non-default sort key. */
  sort?: string;
}

/** Repeated values. Empty ones are dropped. */
const values = parseAsNativeArrayOf(
  createParser({ parse: (value) => value || null, serialize: String }),
);

/**
 * Every /search key, in the order `format` writes them. A list key `x` reads
 * the repeated `x[]`; `legacyX` reads the comma list older links wrote.
 */
const parsers = {
  legacyArrivalWindow: values,
  arrivalWindow: values,
  lat: parseAsFloat,
  lng: parseAsFloat,
  radius: parseAsNumberLiteral(SEARCH_RADIUS_MILES),
  q: parseAsString,
  syntax: parseAsStringLiteral(["expression"]),
  legacyMakes: values,
  makes: values,
  legacyColors: values,
  colors: values,
  legacyStates: values,
  states: values,
  legacyYards: values,
  yards: values,
  legacySources: values,
  sources: values,
  minYear: parseAsInteger,
  maxYear: parseAsInteger,
  legacyYardTypes: values,
  yardTypes: values,
  sort: parseAsString,
};

const urlKeys = {
  legacyArrivalWindow: "arrivalWindow",
  arrivalWindow: "arrivalWindow[]",
  legacyMakes: "makes",
  makes: "makes[]",
  legacyColors: "colors",
  colors: "colors[]",
  legacyStates: "states",
  states: "states[]",
  legacyYards: "yards",
  yards: "yards[]",
  legacySources: "sources",
  sources: "sources[]",
  legacyYardTypes: "yardTypes",
  yardTypes: "yardTypes[]",
} as const;

const LEGACY_KEYS = {
  makes: "legacyMakes",
  colors: "legacyColors",
  states: "legacyStates",
  yards: "legacyYards",
  sources: "legacySources",
} as const satisfies Record<SearchUrlFacet, keyof typeof parsers>;

const serialize = createSerializer(parsers, { urlKeys });
const load = createLoader(parsers, { urlKeys });

/** Every key's value as nuqs reads it from a /search URL. */
export type SearchUrlValues = inferParserType<typeof parsers>;
/** Keys a write sets; a missing key is left as the URL has it. */
export type SearchUrlWrite = Partial<Nullable<SearchUrlValues>>;

/** The keys nuqs writes for `url`, with every facet in `locked` left out. */
function writeValues(
  url: SearchUrl,
  locked: readonly SearchUrlFacet[] = [],
): SearchUrlWrite {
  const q = url.query || null;
  const syntax = q && url.expression ? "expression" : null;
  const values: SearchUrlWrite = {
    arrivalWindow: url.arrivalWindow ? [url.arrivalWindow] : null,
    legacyArrivalWindow: null,
    lat: url.area?.lat ?? null,
    lng: url.area?.lng ?? null,
    radius: url.radius ?? null,
    q,
    syntax,
    minYear: url.minYear ?? null,
    maxYear: url.maxYear ?? null,
    // Only a non-default yard scope is written. `all` stays explicit so a
    // reload cannot reapply the self-service default.
    yardTypes:
      url.yardTypes &&
      !SearchYardSelection.isImplied(
        new URLSearchParams(serialize({ q, syntax })),
        url.yardTypes,
      )
        ? url.yardTypes.length
          ? [...url.yardTypes]
          : ["all"]
        : null,
    legacyYardTypes: null,
    sort: url.sort ?? null,
  };
  for (const key of FACET_KEYS) {
    if (locked.includes(key)) continue;
    values[key] = url.facets?.[key]?.filter(Boolean) ?? null;
    values[LEGACY_KEYS[key]] = null;
  }
  return values;
}

/**
 * The canonical form of a search URL, for links that open a search (such
 * as saved searches and alert emails) and for comparing two URLs. `locked`
 * supplies raw facet params to keep for a viewer who cannot edit them; a
 * facet in `url.facets` replaces them.
 */
function format(
  pathname: string,
  url: SearchUrl,
  locked?: URLSearchParams,
): string {
  const facets: SearchUrlWrite = {};
  for (const key of FACET_KEYS) {
    if (url.facets?.[key] || !locked) continue;
    facets[key] = locked.getAll(`${key}[]`);
    facets[LEGACY_KEYS[key]] = locked.getAll(key);
  }
  const search = serialize({ ...writeValues(url), ...facets });
  // nuqs leaves brackets and commas unencoded. Re-encode them the way
  // links have always written them.
  const queryString = new URLSearchParams(search).toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
}

/**
 * Reads a search URL. Repeated `x[]` keys win over legacy comma lists, which
 * `knownYardNames` splits without breaking names that contain commas.
 */
function parse(
  params: URLSearchParams,
  knownYardNames: readonly string[] = [],
): SearchUrl {
  return fromValues(load(params), knownYardNames);
}

/** `values` once nuqs applies `write` to them. */
function merge(
  values: SearchUrlValues,
  write: SearchUrlWrite,
): SearchUrlValues {
  return load(
    new URLSearchParams(
      serialize(new URLSearchParams(serialize(values)), write),
    ),
  );
}

/** Reads the values nuqs holds for a /search URL, as `parse` reads the URL. */
function fromValues(
  loaded: SearchUrlValues,
  knownYardNames: readonly string[] = [],
): SearchUrl {
  const url: SearchUrl = {};
  const arrivalWindow = ArrivalWindow.parse(
    loaded.arrivalWindow[0] ??
      SearchFilterUrl.splitLegacy(loaded.legacyArrivalWindow)[0],
  );
  if (arrivalWindow) url.arrivalWindow = arrivalWindow;
  const area = SearchArea.schema.safeParse({
    lat: loaded.lat,
    lng: loaded.lng,
    radiusMiles: loaded.radius,
  });
  if (area.success) url.area = { lat: area.data.lat, lng: area.data.lng };
  if (loaded.radius !== null) url.radius = loaded.radius;
  if (loaded.q) url.query = loaded.q;
  if (loaded.syntax) url.expression = true;
  const facets: SearchUrl["facets"] = {};
  for (const key of FACET_KEYS) {
    const repeated = loaded[key];
    const read = repeated.length
      ? repeated
      : SearchFilterUrl.splitLegacy(
          loaded[LEGACY_KEYS[key]],
          key === "yards" ? knownYardNames : [],
        );
    if (read.length) facets[key] = read;
  }
  if (Object.keys(facets).length) url.facets = facets;
  if (loaded.minYear !== null) url.minYear = loaded.minYear;
  if (loaded.maxYear !== null) url.maxYear = loaded.maxYear;
  // As for facets, an empty repeated key falls back to the legacy one.
  const selection = SearchYardSelection.fromValues(
    loaded.yardTypes.length
      ? loaded.yardTypes
      : SearchFilterUrl.splitLegacy(loaded.legacyYardTypes),
    loaded.syntax ? (loaded.q ?? "") : null,
  );
  if (selection.kind !== "default")
    url.yardTypes = SearchYardSelection.effectiveTypes(selection);
  if (loaded.sort) url.sort = loaded.sort;
  return url;
}

export const SearchUrl = {
  facets: FACET_KEYS,
  parsers,
  urlKeys,
  format,
  parse,
  fromValues,
  writeValues,
  merge,
  load,
} as const;
