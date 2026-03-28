"use client";

import { AlertCircle, Search } from "lucide-react";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Configure,
  useClearRefinements,
  useInfiniteHits,
  useInstantSearch,
  useRange,
  useRefinementList,
  useSortBy,
  useStats,
} from "react-instantsearch";
import { InstantSearchNext } from "react-instantsearch-nextjs";
import { useQueryState } from "nuqs";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { MobileFiltersDrawer } from "~/components/search/MobileFiltersDrawer";
import { MorphingFilterBar } from "~/components/search/MorphingFilterBar";
import { MorphingSearchBar } from "~/components/search/MorphingSearchBar";
import {
  clearPendingSaveSearch,
  SaveSearchDialog,
} from "~/components/search/SaveSearchDialog";
import { SavedSearchesDropdown } from "~/components/search/SavedSearchesDropdown";
import { SavedSearchesList } from "~/components/search/SavedSearchesList";
import {
  SearchResults,
  SearchSummary,
} from "~/components/search/SearchResults";
import { Sidebar } from "~/components/search/Sidebar";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useIsMobile } from "~/hooks/use-media-query";
import { AnalyticsEvents, buildSearchContext } from "~/lib/analytics-events";
import { searchClient, ALGOLIA_INDEX_NAME } from "~/lib/algolia-search";
import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";
import type {
  DataSource,
  SearchResult as SearchResultType,
} from "~/lib/types";
import { api } from "~/trpc/react";

// Module-level sort options — single source of truth for all sort mappings.
const SORT_OPTIONS: { indexName: string; key: string; label: string }[] = [
  { indexName: ALGOLIA_INDEX_NAME, key: "newest", label: "Newest First" },
  { indexName: "vehicles_oldest", key: "oldest", label: "Oldest First" },
  {
    indexName: "vehicles_year_desc",
    key: "year-desc",
    label: "Year (High to Low)",
  },
  {
    indexName: "vehicles_year_asc",
    key: "year-asc",
    label: "Year (Low to High)",
  },
  {
    indexName: "vehicles_distance",
    key: "distance",
    label: "Distance (Nearest)",
  },
];
const SORT_ITEMS = SORT_OPTIONS.map(({ indexName, label }) => ({
  value: indexName,
  label,
}));
const INDEX_TO_KEY = Object.fromEntries(
  SORT_OPTIONS.map((o) => [o.indexName, o.key]),
);
const KEY_TO_INDEX = Object.fromEntries(
  SORT_OPTIONS.map((o) => [o.key, o.indexName]),
);
const KNOWN_SORT_INDICES = new Set(SORT_OPTIONS.map((o) => o.indexName));

interface SearchPageContentProps {
  isLoggedIn?: boolean;
  userLocation?: { lat: number; lng: number };
}

/**
 * Inner component that uses Algolia hooks (must be inside InstantSearch provider).
 */
function AlgoliaSearchInner({
  isLoggedIn,
  userLocation,
}: SearchPageContentProps) {
  const currentYear = new Date().getFullYear();
  const isMobile = useIsMobile();
  const lastTrackedQuery = useRef("");

  // Prefetch saved searches
  api.savedSearches.list.useQuery(undefined, { enabled: !!isLoggedIn });

  // Sidebar state
  const [showFilters, setShowFilters] = useState(false);

  // Auto-open save search dialog after auth redirect
  const [saveSearchParam, setSaveSearchParam] = useQueryState("saveSearch");
  const [autoOpenSaveDialog, setAutoOpenSaveDialog] = useState(false);

  useEffect(() => {
    if (saveSearchParam && isLoggedIn) {
      setAutoOpenSaveDialog(true);
      void setSaveSearchParam(null);
      clearPendingSaveSearch();
    }
  }, [saveSearchParam, isLoggedIn, setSaveSearchParam]);

  // Handle subscription success
  const [subscriptionParam, setSubscriptionParam] =
    useQueryState("subscription");
  const [customerSessionToken, setCustomerSessionToken] = useQueryState(
    "customer_session_token",
  );

  useEffect(() => {
    const isCheckoutSuccess =
      subscriptionParam === "success" || customerSessionToken;
    if (isCheckoutSuccess) {
      posthog.capture(AnalyticsEvents.SUBSCRIPTION_ACTIVATED, {
        source: "checkout_redirect",
      });
      toast.success(
        "Subscription activated! Email alerts are now enabled for your saved searches.",
      );
      if (subscriptionParam) void setSubscriptionParam(null);
      if (customerSessionToken) void setCustomerSessionToken(null);
    }
  }, [
    subscriptionParam,
    setSubscriptionParam,
    customerSessionToken,
    setCustomerSessionToken,
  ]);

  const handleAutoOpenHandled = useCallback(() => {
    setAutoOpenSaveDialog(false);
  }, []);

  // ── Algolia hooks ──────────────────────────────────────────────────────

  const { indexUiState, setIndexUiState, status, error } = useInstantSearch({
    catchError: true,
  });
  const refinementList = (indexUiState.refinementList ?? {}) as Record<
    string,
    string[]
  >;
  const yearRangeState = (indexUiState.range ?? {}) as Record<string, string>;
  const query = (indexUiState.query as string) ?? "";
  const { hits, showMore, isLastPage } = useInfiniteHits();
  const { nbHits, processingTimeMS } = useStats();

  // Facets
  const { items: makeItems, refine: refineMake } = useRefinementList({
    attribute: "make",
    limit: 100,
    sortBy: ["name:asc"],
  });
  const { items: colorItems, refine: refineColor } = useRefinementList({
    attribute: "color",
    limit: 50,
    sortBy: ["name:asc"],
  });
  const { items: stateItems, refine: refineState } = useRefinementList({
    attribute: "state",
    limit: 60,
    sortBy: ["name:asc"],
  });
  const { items: locationItems, refine: refineLocation } = useRefinementList({
    attribute: "locationName",
    limit: 500,
    sortBy: ["name:asc"],
  });
  const { refine: refineSource } = useRefinementList({
    attribute: "source",
    limit: 10,
  });

  // Year range
  const {
    range: yearBounds,
    start: yearStart,
    refine: refineYear,
  } = useRange({
    attribute: "year",
  });

  // Server-side sorting via Algolia replicas.
  // Virtual replicas for date/year (share records with primary).
  // Standard replica for distance (separate index with geo-dominant ranking).
  const { currentRefinement: currentSortIndex, refine: refineSortBy } =
    useSortBy({ items: SORT_ITEMS });

  const sortBy = useMemo(
    () => INDEX_TO_KEY[currentSortIndex] ?? "newest",
    [currentSortIndex],
  );

  // ── Derived state ──────────────────────────────────────────────────────

  // Map Algolia hits to search-display vehicles.
  const vehicles = useMemo(
    () =>
      hits.map((hit) =>
        algoliaHitToSearchVehicle(
          hit as Record<string, unknown>,
          userLocation,
        ),
      ),
    [hits, userLocation],
  );

  const filterOptions = useMemo(
    () => ({
      makes: makeItems.map((i) => i.value).sort(),
      colors: colorItems.map((i) => i.value).sort(),
      states: stateItems.map((i) => i.value).sort(),
      salvageYards: locationItems.map((i) => i.value).sort(),
    }),
    [makeItems, colorItems, stateItems, locationItems],
  );

  // Selected filters
  const selectedMakes = useMemo(
    () => refinementList.make ?? [],
    [refinementList],
  );
  const selectedColors = useMemo(
    () => refinementList.color ?? [],
    [refinementList],
  );
  const selectedStates = useMemo(
    () => refinementList.state ?? [],
    [refinementList],
  );
  const selectedLocations = useMemo(
    () => refinementList.locationName ?? [],
    [refinementList],
  );
  const selectedSources = useMemo(
    () =>
      (refinementList.source ?? []).filter(
        (value): value is DataSource =>
          value === "pyp" || value === "row52" || value === "autorecycler",
      ),
    [refinementList],
  );

  const [routeMinYear, routeMaxYear] = (yearRangeState.year ?? "")
    .split(":")
    .map((value) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    });

  const yearMin =
    typeof yearBounds.min === "number" && Number.isFinite(yearBounds.min) && yearBounds.min > 0
      ? yearBounds.min
      : 1900;
  const yearMax =
    typeof yearBounds.max === "number" && Number.isFinite(yearBounds.max) && yearBounds.max > 0
      ? yearBounds.max
      : currentYear;
  const yearRange: [number, number] = [
    routeMinYear ??
      (Number.isFinite(yearStart[0]) ? (yearStart[0] as number) : yearMin),
    routeMaxYear ??
      (Number.isFinite(yearStart[1]) ? (yearStart[1] as number) : yearMax),
  ];
  const isYearFiltered = yearRange[0] !== yearMin || yearRange[1] !== yearMax;

  const activeFilterCount =
    selectedMakes.length +
    selectedColors.length +
    selectedStates.length +
    selectedLocations.length +
    selectedSources.length +
    (isYearFiltered ? 1 : 0);

  // Only show results when there's a non-empty search query
  const hasActiveSearch = query.length > 0;

  // Loading = Algolia is actively fetching (not stale "0 results")
  const isSearching =
    hasActiveSearch && (status === "loading" || status === "stalled");

  // Build search result object for SearchResults/SearchSummary components
  const searchResult: SearchResultType | null = useMemo(() => {
    if (!hasActiveSearch) return null;
    if (
      (status === "loading" || status === "stalled" || status === "error") &&
      hits.length === 0
    )
      return null;
    return {
      vehicles,
      totalCount: nbHits,
      page: 1,
      hasMore: !isLastPage,
      searchTime: processingTimeMS,
      locationsCovered: 0,
      locationsWithErrors: [],
    };
  }, [
    vehicles,
    nbHits,
    isLastPage,
    processingTimeMS,
    hasActiveSearch,
    status,
    hits.length,
  ]);

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleSortChange = useCallback(
    (value: string) => {
      posthog.capture(AnalyticsEvents.SORT_CHANGED, { sort_option: value });
      refineSortBy(KEY_TO_INDEX[value] ?? ALGOLIA_INDEX_NAME);
    },
    [refineSortBy],
  );

  const handleToggleFilters = useCallback(
    () => setShowFilters((prev) => !prev),
    [],
  );

  const { refine: clearRefinements } = useClearRefinements();

  const clearAllFilters = useCallback(() => {
    posthog.capture(AnalyticsEvents.FILTERS_CLEARED, {
      previous_filter_count: activeFilterCount,
    });
    clearRefinements();
    refineSortBy(ALGOLIA_INDEX_NAME);
    setShowFilters(false);
  }, [activeFilterCount, clearRefinements, refineSortBy]);

  // Helper: toggle only the values that changed between current and next.
  const applyRefinementDiff = useCallback(
    (current: string[], next: string[], refine: (value: string) => void) => {
      const currentSet = new Set(current);
      const nextSet = new Set(next);
      for (const v of currentSet) if (!nextSet.has(v)) refine(v);
      for (const v of nextSet) if (!currentSet.has(v)) refine(v);
    },
    [],
  );

  // Filter change handlers that toggle individual values
  const handleMakesChange = useCallback(
    (newMakes: string[]) =>
      applyRefinementDiff(selectedMakes, newMakes, refineMake),
    [selectedMakes, refineMake, applyRefinementDiff],
  );

  const handleColorsChange = useCallback(
    (newColors: string[]) =>
      applyRefinementDiff(selectedColors, newColors, refineColor),
    [selectedColors, refineColor, applyRefinementDiff],
  );

  const handleStatesChange = useCallback(
    (newStates: string[]) =>
      applyRefinementDiff(selectedStates, newStates, refineState),
    [selectedStates, refineState, applyRefinementDiff],
  );

  const handleLocationsChange = useCallback(
    (newLocations: string[]) =>
      applyRefinementDiff(selectedLocations, newLocations, refineLocation),
    [selectedLocations, refineLocation, applyRefinementDiff],
  );

  const handleSourcesChange = useCallback(
    (newSources: DataSource[]) =>
      applyRefinementDiff(selectedSources, newSources, refineSource),
    [selectedSources, refineSource, applyRefinementDiff],
  );

  const handleYearRangeChange = useCallback(
    (range: [number, number]) => {
      refineYear(range);
    },
    [refineYear],
  );

  // Track search outcomes (skip errors so failed queries can be re-tracked on success)
  useEffect(() => {
    if (!query || isSearching || error) return;
    if (lastTrackedQuery.current === query) return;
    lastTrackedQuery.current = query;

    const ctx = buildSearchContext(query, nbHits, processingTimeMS, 0);

    if (nbHits === 0) {
      posthog.capture(AnalyticsEvents.SEARCH_EMPTY, ctx);
    } else {
      posthog.capture(AnalyticsEvents.SEARCH_COMPLETED, ctx);
    }
  }, [query, isSearching, error, nbHits, processingTimeMS]);

  // Keyboard shortcuts: Cmd/Ctrl+K to focus search, F to toggle filters
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        document.getElementById("search")?.focus();
        return;
      }
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "f" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowFilters((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Load more when scrolling near bottom
  // Infinite scroll is handled inside SearchResults via the virtualizer.
  // showMore and isLastPage are passed as props.

  // Only send geo params when distance sort is active.
  // The distance replica has a geo-dominant ranking array.
  // Other sorts must NOT send aroundLatLng or geo would override customRanking.
  const isDistanceSort = sortBy === "distance";
  const aroundLatLng =
    isDistanceSort && userLocation
      ? `${userLocation.lat}, ${userLocation.lng}`
      : undefined;

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
      <Configure
        // Intentionally 1000 (Algolia max). Small page sizes break sorting:
        // virtual replicas with relevancyStrictness:0 + useInfiniteHits
        // reset on sort switch, and the virtualizer needs enough rows to
        // render without the "5 results" bug. 1000 per page means most
        // queries complete in 1-2 API calls.
        hitsPerPage={1000}
        aroundLatLng={aroundLatLng}
        aroundLatLngViaIP={isDistanceSort && !userLocation}
        aroundRadius={isDistanceSort ? "all" : undefined}
      />
      <ErrorBoundary>
        <MorphingSearchBar />
      </ErrorBoundary>

      <div className="relative flex w-full gap-6">
        {/* Desktop Sidebar */}
        {!isMobile && showFilters && (
          <div className="sticky top-24 h-fit max-h-[calc(100vh-112px)] overflow-y-auto">
            <Sidebar
              showFilters={showFilters}
              setShowFilters={setShowFilters}
              activeFilterCount={activeFilterCount}
              clearAllFilters={clearAllFilters}
              makes={selectedMakes}
              colors={selectedColors}
              states={selectedStates}
              salvageYards={selectedLocations}
              sources={selectedSources}
              yearRange={yearRange}
              filterOptions={filterOptions}
              onMakesChange={handleMakesChange}
              onColorsChange={handleColorsChange}
              onStatesChange={handleStatesChange}
              onSalvageYardsChange={handleLocationsChange}
              onSourcesChange={handleSourcesChange}
              onYearRangeChange={handleYearRangeChange}
              yearRangeLimits={{ min: yearMin, max: yearMax }}
            />
          </div>
        )}

        {/* Main Content */}
        <div className="w-full flex-1">
          {/* Search Results Header */}
          {(isSearching || searchResult) && (
            <div className="mb-6">
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                {isSearching ? (
                  <div>
                    <Skeleton className="mb-2 h-8 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ) : searchResult ? (
                  <div>
                    <h2 className="text-foreground text-2xl font-black">
                      Search Results
                    </h2>
                    <p className="text-muted-foreground">
                      {searchResult.totalCount.toLocaleString()} vehicles found
                    </p>
                  </div>
                ) : null}

                {/* Filter buttons */}
                {isMobile ? (
                  <div className="flex items-center gap-2">
                    {isLoggedIn && <SavedSearchesDropdown />}
                    <SaveSearchDialog
                      query={query}
                      filters={{
                        makes: selectedMakes,
                        colors: selectedColors,
                        states: selectedStates,
                        salvageYards: selectedLocations,
                        sources: selectedSources,
                        minYear: yearRange[0],
                        maxYear: yearRange[1],
                        sortBy,
                      }}
                      disabled={!query}
                      isLoggedIn={isLoggedIn}
                      autoOpen={autoOpenSaveDialog}
                      onAutoOpenHandled={handleAutoOpenHandled}
                    />
                    <MobileFiltersDrawer
                      activeFilterCount={activeFilterCount}
                      clearAllFilters={clearAllFilters}
                      makes={selectedMakes}
                      colors={selectedColors}
                      states={selectedStates}
                      salvageYards={selectedLocations}
                      sources={selectedSources}
                      yearRange={yearRange}
                      filterOptions={filterOptions}
                      onMakesChange={handleMakesChange}
                      onColorsChange={handleColorsChange}
                      onStatesChange={handleStatesChange}
                      onSalvageYardsChange={handleLocationsChange}
                      onSourcesChange={handleSourcesChange}
                      onYearRangeChange={handleYearRangeChange}
                      yearRangeLimits={{ min: yearMin, max: yearMax }}
                    />
                  </div>
                ) : (
                  <MorphingFilterBar
                    query={query}
                    sortBy={sortBy}
                    onSortChange={handleSortChange}
                    activeFilterCount={activeFilterCount}
                    showFilters={showFilters}
                    onToggleFilters={handleToggleFilters}
                    isLoggedIn={isLoggedIn}
                    filters={{
                      makes: selectedMakes,
                      colors: selectedColors,
                      states: selectedStates,
                      salvageYards: selectedLocations,
                      sources: selectedSources,
                      minYear: yearRange[0],
                      maxYear: yearRange[1],
                      sortBy,
                    }}
                    autoOpenSaveDialog={autoOpenSaveDialog}
                    onAutoOpenHandled={handleAutoOpenHandled}
                    disabled={!query}
                    loading={isSearching}
                  />
                )}
              </div>

              {/* Search Stats */}
              {isSearching ? (
                <div className="mb-6 flex items-center justify-between text-sm">
                  <Skeleton className="h-4 w-48" />
                </div>
              ) : searchResult ? (
                <div className="text-muted-foreground mb-6 flex items-center justify-between text-sm">
                  <span>Results in {processingTimeMS}ms</span>
                </div>
              ) : null}
            </div>
          )}

          {/* Empty State */}
          {!hasActiveSearch && !isSearching && (
            <div className="py-8 sm:py-12">
              <div className="sm:hidden">
                <h1 className="text-foreground mb-2 text-3xl font-bold tracking-tight">
                  Find Your Parts
                </h1>
                <p className="text-muted-foreground mb-6 text-base">
                  Search across all available salvage yard locations
                </p>
                <div className="mb-8 flex flex-wrap gap-3">
                  {["Honda Civic", "2020 Toyota", "Ford F-150"].map((term) => (
                    <button
                      key={term}
                      type="button"
                      onClick={() =>
                        setIndexUiState((prev) => ({
                          ...prev,
                          query: term,
                        }))
                      }
                      className="bg-muted hover:bg-muted/80 text-foreground inline-flex cursor-pointer items-center rounded-full px-4 py-2 text-sm font-medium transition-colors"
                    >
                      {term}
                    </button>
                  ))}
                </div>
                {isLoggedIn && <SavedSearchesList />}
              </div>

              <div className="hidden text-center sm:block">
                <div className="bg-muted mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full">
                  <Search className="text-muted-foreground h-12 w-12" />
                </div>
                <h2 className="text-foreground mb-2 text-lg font-medium">
                  Search for vehicles
                </h2>
                <p className="text-muted-foreground mx-auto max-w-md">
                  Enter a year, make, model, or any combination to search across
                  all available salvage yard locations.
                </p>
                {isLoggedIn && <SavedSearchesList />}
              </div>
            </div>
          )}

          {/* Search Results */}
          {(searchResult ?? isSearching) && !error && (
            <SearchResults
              searchResult={
                searchResult ?? {
                  vehicles: [],
                  totalCount: 0,
                  page: 1,
                  hasMore: false,
                  searchTime: 0,
                  locationsCovered: 0,
                  locationsWithErrors: [],
                }
              }
              isLoading={isSearching && hits.length === 0}
              sidebarOpen={!isMobile && showFilters}
              showMore={showMore}
              isLastPage={isLastPage}
              isFetchingNextPage={status === "loading" || status === "stalled"}
            />
          )}

          {/* Search Error */}
          {error && !isSearching && (
            <div className="py-12 text-center">
              <div className="bg-destructive/10 mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full">
                <AlertCircle className="text-destructive h-12 w-12" />
              </div>
              <h2 className="text-foreground mb-2 text-lg font-medium">
                Search unavailable
              </h2>
              <p className="text-muted-foreground mx-auto max-w-md">
                We&apos;re having trouble connecting to search. Please try again
                in a moment.
              </p>
            </div>
          )}

          {/* No Results */}
          {query &&
            searchResult?.totalCount === 0 &&
            !isSearching &&
            !error && (
              <div className="py-12 text-center">
                <div className="bg-muted mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full">
                  <AlertCircle className="text-muted-foreground h-12 w-12" />
                </div>
                <h2 className="text-foreground mb-2 text-lg font-medium">
                  No vehicles found
                </h2>
                <p className="text-muted-foreground mx-auto mb-6 max-w-md">
                  {activeFilterCount > 0
                    ? "No vehicles match your current filters. Try adjusting your filters."
                    : "No vehicles match your search. Try different search terms."}
                </p>
                {activeFilterCount > 0 && (
                  <Button onClick={clearAllFilters} variant="outline">
                    Clear All Filters
                  </Button>
                )}
              </div>
            )}
        </div>
      </div>

      {searchResult && <SearchSummary searchResult={searchResult} />}
    </div>
  );
}

/**
 * Custom routing that maps our URL params ↔ Algolia UI state.
 * This preserves backward compatibility with saved search URLs
 * (e.g. /search?q=volvo&makes=HONDA,TOYOTA&states=California&minYear=2019)
 */
function createRouting(indexName: string) {
  return {
    router: {
      cleanUrlOnDispose: false,
      createURL({
        routeState,
        location,
      }: {
        routeState: Record<string, Record<string, unknown>>;
        location: Location;
      }): string {
        const baseUrl = location.href.split("?")[0]!;
        const params = new URLSearchParams();

        const state = routeState[indexName] as
          | Record<string, unknown>
          | undefined;
        if (!state) return baseUrl;

        if (state.query) params.set("q", state.query as string);
        if (state.makes)
          params.set("makes", (state.makes as string[]).join(","));
        if (state.colors)
          params.set("colors", (state.colors as string[]).join(","));
        if (state.states)
          params.set("states", (state.states as string[]).join(","));
        if (state.yards)
          params.set("yards", (state.yards as string[]).join(","));
        if (state.sources)
          params.set("sources", (state.sources as string[]).join(","));
        if (state.minYear) params.set("minYear", String(state.minYear));
        if (state.maxYear) params.set("maxYear", String(state.maxYear));
        if (state.sort) params.set("sort", state.sort as string);

        const qs = params.toString();
        return qs ? `${baseUrl}?${qs}` : baseUrl;
      },
      parseURL({ location }: { location: Location }) {
        const params = new URLSearchParams(location.search);
        const state: Record<string, unknown> = {};

        const q = params.get("q");
        if (q) state.query = q;

        const makes = params.get("makes");
        if (makes) state.makes = makes.split(",").filter(Boolean);

        const colors = params.get("colors");
        if (colors) state.colors = colors.split(",").filter(Boolean);

        const states = params.get("states");
        if (states) state.states = states.split(",").filter(Boolean);

        const yards = params.get("yards");
        if (yards) state.yards = yards.split(",").filter(Boolean);

        const sources = params.get("sources");
        if (sources) state.sources = sources.split(",").filter(Boolean);

        const minYear = params.get("minYear");
        if (minYear) {
          const parsed = parseInt(minYear, 10);
          if (!Number.isNaN(parsed)) state.minYear = parsed;
        }

        const maxYear = params.get("maxYear");
        if (maxYear) {
          const parsed = parseInt(maxYear, 10);
          if (!Number.isNaN(parsed)) state.maxYear = parsed;
        }

        const sort = params.get("sort");
        if (sort) state.sort = sort;

        return { [indexName]: state };
      },
    },
    stateMapping: {
      stateToRoute(uiState: Record<string, Record<string, unknown>>) {
        const indexState = uiState[indexName] ?? {};
        const state: Record<string, unknown> = {};

        if (indexState.query) state.query = indexState.query;

        // Persist sort as human-readable key (e.g. "oldest" not "vehicles_oldest")
        if (indexState.sortBy && indexState.sortBy !== indexName) {
          state.sort =
            INDEX_TO_KEY[indexState.sortBy as string] ?? indexState.sortBy;
        }

        // Extract refinement lists
        const refinementList = indexState.refinementList as
          | Record<string, string[]>
          | undefined;
        if (refinementList?.make?.length) state.makes = refinementList.make;
        if (refinementList?.color?.length) state.colors = refinementList.color;
        if (refinementList?.state?.length) state.states = refinementList.state;
        if (refinementList?.locationName?.length)
          state.yards = refinementList.locationName;
        if (refinementList?.source?.length)
          state.sources = refinementList.source;

        // Extract numeric range
        const range = indexState.range as Record<string, string> | undefined;
        if (range?.year) {
          const [min, max] = (range.year as string).split(":");
          if (min) {
            const parsed = parseInt(min, 10);
            if (!Number.isNaN(parsed)) state.minYear = parsed;
          }
          if (max) {
            const parsed = parseInt(max, 10);
            if (!Number.isNaN(parsed)) state.maxYear = parsed;
          }
        }

        return { [indexName]: state };
      },
      routeToState(routeState: Record<string, Record<string, unknown>>) {
        const state = routeState[indexName] ?? {};
        const uiState: Record<string, unknown> = {};

        if (state.query) uiState.query = state.query;

        // Restore sort — map human key to index name, validate, then set
        if (state.sort) {
          const mapped =
            KEY_TO_INDEX[state.sort as string] ?? (state.sort as string);
          if (KNOWN_SORT_INDICES.has(mapped)) {
            uiState.sortBy = mapped;
          }
        }

        // Build refinement lists
        const refinementList: Record<string, string[]> = {};
        if (state.makes) refinementList.make = state.makes as string[];
        if (state.colors) refinementList.color = state.colors as string[];
        if (state.states) refinementList.state = state.states as string[];
        if (state.yards) refinementList.locationName = state.yards as string[];
        if (state.sources) refinementList.source = state.sources as string[];
        if (Object.keys(refinementList).length > 0) {
          uiState.refinementList = refinementList;
        }

        // Build range
        if (state.minYear || state.maxYear) {
          uiState.range = {
            year: `${state.minYear ?? ""}:${state.maxYear ?? ""}`,
          };
        }

        return { [indexName]: uiState };
      },
    },
  };
}

const INSTANT_SEARCH_FUTURE = { preserveSharedStateOnUnmount: true } as const;

/**
 * Main SearchPageContent — wraps everything in InstantSearch provider.
 */
export function SearchPageContent({
  isLoggedIn,
  userLocation,
}: SearchPageContentProps) {
  const routing = useMemo(() => createRouting(ALGOLIA_INDEX_NAME), []);

  return (
    <InstantSearchNext
      searchClient={searchClient}
      indexName={ALGOLIA_INDEX_NAME}
      routing={routing}
      future={INSTANT_SEARCH_FUTURE}
    >
      <ErrorBoundary>
        <AlgoliaSearchInner
          isLoggedIn={isLoggedIn}
          userLocation={userLocation}
        />
      </ErrorBoundary>
    </InstantSearchNext>
  );
}
