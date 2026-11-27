import type { IndexUiState } from "instantsearch.js";
import { ALGOLIA_INDEX_NAME, ALGOLIA_NEWEST_INDEX_NAME } from "~/lib/constants";
import { SearchFilterUrl } from "~/lib/search-filter-url";
import { SearchUrl } from "~/lib/search-url";
import { SearchYardSelection } from "~/lib/search-yard-selection";
import {
  getMaximumSearchableVehicleYear,
  getSearchableVinPattern,
  MINIMUM_SEARCHABLE_VEHICLE_YEAR,
  sanitizeSearchSources,
  sanitizeYardTypes,
  SEARCH_SORT_OPTIONS,
} from "./search-routing";

type SearchUrlFacet = (typeof SearchUrl.facets)[number];

/** What the viewer's plan and the index allow the search to use. */
export interface SearchUrlPolicy {
  vinPatternIndexReady: boolean;
  canUseAdvancedFilters: boolean;
  newestSortReady: boolean;
}

const REFINEMENTS = [
  ["makes", "make"],
  ["colors", "color"],
  ["states", "state"],
  ["yards", "locationName"],
  ["sources", "source"],
] as const satisfies readonly (readonly [SearchUrlFacet, string])[];

// A free arrival link may scope its window to yards; every other facet is paid.
const ARRIVAL_FACETS: readonly SearchUrlFacet[] = [
  "states",
  "yards",
  "sources",
];

const KNOWN_SORT_INDICES = new Set(
  SEARCH_SORT_OPTIONS.map((option) => option.indexName),
);

function defaultSortIndex(policy: SearchUrlPolicy): string {
  return policy.newestSortReady
    ? ALGOLIA_NEWEST_INDEX_NAME
    : ALGOLIA_INDEX_NAME;
}

/** The facets this viewer may refine from the URL. */
function editableFacets(
  url: SearchUrl,
  policy: SearchUrlPolicy,
): readonly SearchUrlFacet[] {
  if (policy.canUseAdvancedFilters) return SearchUrl.facets;
  return url.arrivalWindow ? ARRIVAL_FACETS : [];
}

function vinPattern(url: SearchUrl, policy: SearchUrlPolicy) {
  return policy.vinPatternIndexReady && !url.expression
    ? getSearchableVinPattern(url.query ?? null)
    : null;
}

/** The InstantSearch state a /search URL describes for this viewer. */
function toUiState(url: SearchUrl, policy: SearchUrlPolicy): IndexUiState {
  const uiState: IndexUiState = {};
  if (url.query && !vinPattern(url, policy)) uiState.query = url.query;

  const sort = url.sort ?? (policy.newestSortReady ? "newest" : "relevance");
  // A sort key, or an index name as older links wrote.
  const index =
    SEARCH_SORT_OPTIONS.find((option) => option.key === sort)?.indexName ??
    sort;
  uiState.sortBy =
    !KNOWN_SORT_INDICES.has(index) ||
    (!policy.newestSortReady && index === ALGOLIA_NEWEST_INDEX_NAME)
      ? defaultSortIndex(policy)
      : index;

  const refinementList: Record<string, string[]> = {};
  const editable = editableFacets(url, policy);
  for (const [facet, attribute] of REFINEMENTS) {
    const values = url.facets?.[facet];
    if (!values || !editable.includes(facet)) continue;
    const kept = facet === "sources" ? sanitizeSearchSources(values) : values;
    if (kept.length) refinementList[attribute] = [...kept];
  }
  if (url.minYear || url.maxYear)
    uiState.range = { year: `${url.minYear ?? ""}:${url.maxYear ?? ""}` };
  refinementList.yardTypes = url.yardTypes
    ? sanitizeYardTypes(url.yardTypes)
    : ["self_service"];
  uiState.refinementList = refinementList;
  return uiState;
}

function readYears(range: IndexUiState["range"]) {
  const [min, max] = (range?.year ?? "").split(":");
  const minYear = min ? Number.parseInt(min, 10) : Number.NaN;
  const maxYear = max ? Number.parseInt(max, 10) : Number.NaN;
  return {
    minYear:
      Number.isNaN(minYear) || minYear === MINIMUM_SEARCHABLE_VEHICLE_YEAR
        ? undefined
        : minYear,
    maxYear:
      Number.isNaN(maxYear) || maxYear === getMaximumSearchableVehicleYear()
        ? undefined
        : maxYear,
  };
}

/**
 * The URL for an InstantSearch state. `current` supplies what InstantSearch
 * does not hold: expression syntax, a VIN in `q` (InstantSearch searches ""),
 * the window, origin and radius, and facets the viewer cannot edit, which
 * `locked` lists so a write leaves them as the URL has them.
 */
function fromUiState(
  uiState: IndexUiState,
  policy: SearchUrlPolicy,
  current: SearchUrl,
): { url: SearchUrl; locked: SearchUrlFacet[] } {
  const url: SearchUrl = {};
  if (current.arrivalWindow) url.arrivalWindow = current.arrivalWindow;
  if (current.area) url.area = current.area;
  if (current.radius !== undefined) url.radius = current.radius;
  const query = vinPattern(current, policy)?.normalized ?? uiState.query;
  if (query) url.query = query;
  if (current.expression) url.expression = true;

  const refinementList = uiState.refinementList ?? {};
  const facets: NonNullable<SearchUrl["facets"]> = {};
  const locked: SearchUrlFacet[] = [];
  const editable = editableFacets(current, policy);
  for (const [facet, attribute] of REFINEMENTS) {
    const refined = refinementList[attribute] ?? [];
    const values =
      facet === "sources" ? sanitizeSearchSources(refined) : refined;
    if (values.length) facets[facet] = values;
    else if (!editable.includes(facet)) {
      locked.push(facet);
      const kept = current.facets?.[facet];
      if (kept) facets[facet] = kept;
    }
  }
  if (Object.keys(facets).length) url.facets = facets;

  const { minYear, maxYear } = readYears(uiState.range);
  if (minYear !== undefined) url.minYear = minYear;
  if (maxYear !== undefined) url.maxYear = maxYear;

  const yardTypes = refinementList.yardTypes ?? [];
  url.yardTypes = yardTypes.includes("all") ? [] : sanitizeYardTypes(yardTypes);

  // The sort widget omits sortBy for its primary index, which is Relevance.
  const sortBy = uiState.sortBy ?? ALGOLIA_INDEX_NAME;
  if (sortBy !== defaultSortIndex(policy))
    url.sort =
      SEARCH_SORT_OPTIONS.find((option) => option.indexName === sortBy)?.key ??
      sortBy;
  return { url, locked };
}

/** Same JSON for equal values whatever their key order. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0,
          ),
        )
      : item,
  );
}

/**
 * Equal for InstantSearch states that search the same results under `url`,
 * which supplies what InstantSearch does not hold. Everything refined
 * counts, even a facet this viewer could not have refined from a URL, and
 * the query is the one InstantSearch searches, not a VIN in `url`.
 */
function searchedKey(
  uiState: IndexUiState,
  policy: SearchUrlPolicy,
  url: SearchUrl,
): string {
  const everything = { ...policy, canUseAdvancedFilters: true };
  return stableJson(
    toUiState(
      fromUiState(uiState, everything, { ...url, query: undefined }).url,
      everything,
    ),
  );
}

/** Equal for URLs that search the same results. */
function searchKey(url: SearchUrl, policy: SearchUrlPolicy): string {
  return stableJson(toUiState(url, policy));
}

/**
 * Equal for URLs that differ at most in their query. URLs omit the yard scope
 * their query implies, so it is spelled out first: expression edits that
 * select yard types are still typing.
 */
function typingKey(url: SearchUrl, policy: SearchUrlPolicy): string {
  const params = new URLSearchParams(
    SearchUrl.format("", url).replace(/^\?/, ""),
  );
  const selection = SearchYardSelection.fromUrl(params);
  if (selection.kind !== "explicit") {
    const types = SearchYardSelection.effectiveTypes(selection);
    SearchFilterUrl.write(params, "yardTypes", types.length ? types : ["all"]);
  }
  params.delete("q");
  return searchKey(SearchUrl.parse(params), policy);
}

export const SearchUrlUiState = {
  toUiState,
  fromUiState,
  searchedKey,
  searchKey,
  typingKey,
  stableJson,
} as const;
