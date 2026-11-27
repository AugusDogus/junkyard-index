import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { SearchUrlOrder } from "~/lib/search-url-order";
import { startTransition, useEffect, useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { InstantSearchNext } from "react-instantsearch-nextjs";
import {
  useRefinementList,
  useSearchBox,
  useSortBy,
} from "react-instantsearch";
import { VehicleSearchInput } from "~/components/search/VehicleSearchInput";
import {
  getSearchableVinPattern,
  SEARCH_SORT_OPTIONS,
} from "~/components/search/search-routing";
import {
  SearchUrlProvider,
  SearchUrlSync,
  useSearchUrl,
  useSearchUrlOwner,
} from "~/components/search/search-url-owner";
import { ALGOLIA_INDEX_NAME, getSearchClient } from "~/lib/algolia-search";
import { HiddenSources } from "~/lib/hidden-source";
import { browserSearchKey } from "~/lib/browser-search-key";

browserSearchKey.prime({
  apiKey: "fixture-key",
  expiresInSeconds: 3600,
  tier: "full",
  hiddenSources: [],
});

const router = {
  back() {},
  forward() {},
  refresh() {},
  hmrRefresh() {},
  push() {},
  replace() {},
  async prefetch() {},
};

/** Next marks the history entries it owns with `__NA` (app-router.js). */
const nextHistoryState = { __NA: true };
function isNextHistoryState(state: unknown) {
  return typeof state === "object" && state !== null && "__NA" in state;
}

function Controls() {
  const { query } = useSearchBox();
  const searchUrl = useSearchUrl();
  const { refine: sort, currentRefinement } = useSortBy({
    items: SEARCH_SORT_OPTIONS.map(({ indexName, label }) => ({
      value: indexName,
      label,
    })),
  });
  const { refine: refineState } = useRefinementList({ attribute: "state" });
  useRefinementList({ attribute: "locationName" });
  useRefinementList({ attribute: "yardTypes" });
  return (
    <>
      <VehicleSearchInput
        vinPattern={
          getSearchableVinPattern(searchUrl.values.q)?.normalized ?? ""
        }
        vinPatternSearchReady
        booleanOrSearchReady
        onSearchModeChange={async (value) =>
          searchUrl.setNextQuery(value.vinPattern ?? value.query)
        }
      />
      <label>
        Sort
        <select
          aria-label="Sort"
          value={currentRefinement}
          onChange={(event) => sort(event.target.value)}
        >
          {SEARCH_SORT_OPTIONS.map((option) => (
            <option key={option.key} value={option.indexName}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => refineState("Alabama")}>
        Toggle Alabama
      </button>
      <output id="query">{query}</output>
    </>
  );
}

function Search() {
  const searchUrl = useSearchUrlOwner({
    policy: {
      vinPatternIndexReady: true,
      canUseAdvancedFilters: true,
      newestSortReady: true,
    },
    knownYardNames: [
      "RTP Pick-A-Part - Hebron, KY",
      "RTP Pick-A-Part - Lexington, KY",
    ],
    routedOptions: "fixture",
  });
  return (
    <InstantSearchNext
      indexName={ALGOLIA_INDEX_NAME}
      searchClient={getSearchClient(HiddenSources.none, true, false, true)}
      initialUiState={searchUrl.initialUiState}
      onStateChange={searchUrl.onStateChange}
    >
      <SearchUrlProvider owner={searchUrl.owner}>
        <Controls />
      </SearchUrlProvider>
      <SearchUrlSync state={searchUrl.sync} />
    </InstantSearchNext>
  );
}

// The same Next history bridge as shared-search.tsx: writes carrying `__NA`
// are not seen, other writes become the router's URL in a transition, and
// each committed router state writes its URL back.
function Fixture() {
  const [routeParams, setRouteParams] = useState(
    () => new URLSearchParams(window.location.search),
  );
  useLayoutEffect(() => {
    window.history.replaceState(
      nextHistoryState,
      "",
      `/search?${routeParams.toString()}`,
    );
  }, [routeParams]);
  useEffect(() => {
    const navigate = (url: string) =>
      setRouteParams(new URL(url, window.location.href).searchParams);
    // Like Next's onPopState, Back and Forward commit in a transition, so
    // other popstate listeners (such as nuqs resetting its queue) run first.
    const traverse = () =>
      startTransition(() => navigate(window.location.href));
    window.addEventListener("popstate", traverse);
    const { pushState, replaceState } = window.history;
    for (const [method, original] of [
      ["pushState", pushState],
      ["replaceState", replaceState],
    ] as const)
      window.history[method] = (
        data: unknown,
        unused: string,
        url?: string | URL | null,
      ) => {
        if (isNextHistoryState(data))
          return original.call(window.history, data, unused, url);
        original.call(window.history, nextHistoryState, unused, url);
        const href = url ? String(url) : window.location.href;
        startTransition(() => navigate(href));
      };
    return () => {
      window.removeEventListener("popstate", traverse);
      window.history.pushState = pushState;
      window.history.replaceState = replaceState;
    };
  }, []);
  return (
    <AppRouterContext.Provider value={router}>
      <PathnameContext.Provider value="/search">
        <SearchParamsContext.Provider value={routeParams}>
          <NuqsAdapter processUrlSearchParams={SearchUrlOrder.apply}>
            <Search />
          </NuqsAdapter>
        </SearchParamsContext.Provider>
      </PathnameContext.Provider>
    </AppRouterContext.Provider>
  );
}
createRoot(document.body).render(<Fixture />);
