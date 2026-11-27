import type { IndexUiState } from "instantsearch.js";
import { createSerializer } from "nuqs/server";
import { SearchUrl } from "~/lib/search-url";
import { SearchUrlOrder } from "~/lib/search-url-order";
import { SearchUrlUiState, type SearchUrlPolicy } from "./search-url-ui-state";

export const PAID_POLICY: SearchUrlPolicy = {
  vinPatternIndexReady: true,
  canUseAdvancedFilters: true,
  newestSortReady: true,
};

const serialize = createSerializer(SearchUrl.parsers, {
  urlKeys: SearchUrl.urlKeys,
});

/** The search state a /search URL opens for `policy`, as the page reads it. */
function read(
  href: string,
  policy: SearchUrlPolicy = PAID_POLICY,
  knownYardNames: readonly string[] = [],
): IndexUiState {
  return SearchUrlUiState.toUiState(
    SearchUrl.parse(new URL(href).searchParams, knownYardNames),
    policy,
  );
}

/**
 * The URL after the page writes `uiState` (by default the one `href` opens)
 * onto `href` as `useSearchUrlOwner` does: nuqs sets the keys the write
 * names, keeps the rest and puts them in order. Encoded as URLSearchParams
 * does.
 */
function write(
  href: string,
  policy: SearchUrlPolicy = PAID_POLICY,
  uiState: IndexUiState = read(href, policy),
  knownYardNames: readonly string[] = [],
): string {
  const location = new URL(href);
  const current = SearchUrl.parse(location.searchParams, knownYardNames);
  const { url, locked } = SearchUrlUiState.fromUiState(
    uiState,
    policy,
    current,
  );
  const values = SearchUrl.writeValues(url, locked);
  for (const key of [
    "legacyArrivalWindow",
    "arrivalWindow",
    "radius",
    "lat",
    "lng",
  ] as const)
    delete values[key];
  location.search = SearchUrlOrder.apply(
    new URLSearchParams(serialize(location.searchParams, values)),
  ).toString();
  return location.href;
}

export const SearchUrlTestFixtures = { read, write } as const;
