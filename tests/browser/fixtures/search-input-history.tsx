import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { InstantSearchNext } from "react-instantsearch-nextjs";
import {
  useRefinementList,
  useSearchBox,
  useSortBy,
} from "react-instantsearch";
import { VehicleSearchInput } from "~/components/search/VehicleSearchInput";
import {
  createSearchRouting,
  getSearchableVinPattern,
  SEARCH_SORT_OPTIONS,
} from "~/components/search/search-routing";
import { ALGOLIA_INDEX_NAME, getSearchClient } from "~/lib/algolia-search";
import { browserSearchKey } from "~/lib/browser-search-key";
import { createSearchRouteSync } from "~/lib/search-route-sync";

browserSearchKey.prime({
  apiKey: "fixture-key",
  validUntil: 4_102_444_800,
  tier: "full",
});

// Mirror Next's history bridge, including a new searchParams object per write.
for (const method of ["pushState", "replaceState"] as const) {
  const original = window.history[method].bind(window.history);
  window.history[method] = (...args) => {
    original(...args);
    window.dispatchEvent(new Event("fixture-navigation"));
  };
}

function Controls({ params }: { params: URLSearchParams }) {
  const { query } = useSearchBox();
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
        vinPattern={getSearchableVinPattern(params.get("q"))?.normalized ?? ""}
        vinPatternSearchReady
        booleanOrSearchReady
        onSearchModeChange={async (value) => {
          const url = new URL(window.location.href);
          const next = value.vinPattern ?? value.query;
          if (next) url.searchParams.set("q", next);
          else url.searchParams.delete("q");
          window.history.replaceState(window.history.state, "", url);
        }}
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

function Fixture() {
  const [location, setLocation] = useState(() => new URL(window.location.href));
  useEffect(() => {
    const update = () => setLocation(new URL(window.location.href));
    window.addEventListener("fixture-navigation", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("fixture-navigation", update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  const routing = useMemo(() => {
    const config = createSearchRouting(ALGOLIA_INDEX_NAME, true, true, {
      knownYardNames: [
        "RTP Pick-A-Part - Hebron, KY",
        "RTP Pick-A-Part - Lexington, KY",
      ],
    });
    const sync = createSearchRouteSync(config.router.push);
    return {
      ...config,
      router: {
        ...config.router,
        push: sync.push,
        start: sync.start,
        dispose: sync.dispose,
      },
      onUrlChange: sync.onUrlChange,
    };
  }, []);
  useEffect(() => routing.onUrlChange(location.href), [routing, location]);
  return (
    <PathnameContext.Provider value="/search">
      <SearchParamsContext.Provider value={location.searchParams}>
        <InstantSearchNext
          indexName={ALGOLIA_INDEX_NAME}
          searchClient={getSearchClient(true, false, true)}
          routing={routing}
        >
          <Controls params={location.searchParams} />
        </InstantSearchNext>
      </SearchParamsContext.Provider>
    </PathnameContext.Provider>
  );
}
createRoot(document.body).render(<Fixture />);
