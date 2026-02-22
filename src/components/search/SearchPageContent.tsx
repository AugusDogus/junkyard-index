"use client";

import { AlertCircle, Search } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Configure,
  InstantSearch,
  useInfiniteHits,
  useRange,
  useRefinementList,
  useSearchBox,
  useStats,
} from "react-instantsearch";
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
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useSearchVisibility } from "~/context/SearchVisibilityContext";
import { useIsMobile } from "~/hooks/use-media-query";
import { AnalyticsEvents, buildSearchContext } from "~/lib/analytics-events";
import {
  searchClient,
  ALGOLIA_INDEX_NAME,
} from "~/lib/algolia-search";
import type { Vehicle, DataSource, SearchResult as SearchResultType } from "~/lib/types";
import { calculateDistance } from "~/lib/utils";
import { api } from "~/trpc/react";

/**
 * Map an Algolia hit to the Vehicle type expected by VehicleCard and other components.
 */
function algoliaHitToVehicle(
  hit: Record<string, unknown>,
  userLocation?: { lat: number; lng: number },
): Vehicle {
  const geoloc = hit._geoloc as { lat: number; lng: number } | undefined;
  const hitLat = geoloc?.lat ?? 0;
  const hitLng = geoloc?.lng ?? 0;

  // Calculate distance from user if location is available
  const distance =
    userLocation && hitLat && hitLng
      ? calculateDistance(userLocation.lat, userLocation.lng, hitLat, hitLng)
      : 0;

  return {
    id: (hit.objectID as string) ?? (hit.vin as string) ?? "",
    year: (hit.year as number) ?? 0,
    make: (hit.make as string) ?? "",
    model: (hit.model as string) ?? "",
    color: (hit.color as string) ?? "",
    vin: (hit.objectID as string) ?? "",
    stockNumber: (hit.stockNumber as string) ?? "",
    availableDate: (hit.availableDate as string) ?? "",
    source: (hit.source as DataSource) ?? "pyp",
    location: {
      locationCode: (hit.locationCode as string) ?? "",
      locationPageURL: "",
      name: (hit.locationName as string) ?? "",
      displayName: ((hit.locationName as string) ?? "").replace(
        /^Pick Your Part - /,
        "",
      ),
      address: "",
      city: "",
      state: (hit.state as string) ?? "",
      stateAbbr: (hit.stateAbbr as string) ?? "",
      zip: "",
      phone: "",
      lat: hitLat,
      lng: hitLng,
      distance,
      legacyCode: "",
      primo: "",
      source: (hit.source as DataSource) ?? "pyp",
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
    images: (hit.imageUrl as string)
      ? [{ url: hit.imageUrl as string }]
      : [],
    detailsUrl: (hit.detailsUrl as string) ?? "",
    partsUrl: (hit.partsUrl as string) ?? "",
    pricesUrl: (hit.pricesUrl as string) ?? "",
    engine: (hit.engine as string) ?? undefined,
    trim: (hit.trim as string) ?? undefined,
    transmission: (hit.transmission as string) ?? undefined,
  };
}

interface SearchPageContentProps {
  isLoggedIn?: boolean;
  userLocation?: { lat: number; lng: number };
}

/**
 * Inner component that uses Algolia hooks (must be inside InstantSearch provider).
 */
function AlgoliaSearchInner({ isLoggedIn, userLocation }: SearchPageContentProps) {
  const currentYear = new Date().getFullYear();
  const isMobile = useIsMobile();
  const { searchStateRef } = useSearchVisibility();
  const lastTrackedQuery = useRef("");

  // Prefetch saved searches
  api.savedSearches.list.useQuery(undefined, { enabled: isLoggedIn });

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

  const { query, refine: setQuery } = useSearchBox();
  const { hits, showMore, isLastPage } = useInfiniteHits();
  const { nbHits, processingTimeMS } = useStats();

  // Facets
  const {
    items: makeItems,
    refine: refineMake,
  } = useRefinementList({ attribute: "make", limit: 100, sortBy: ["name:asc"] });
  const {
    items: colorItems,
    refine: refineColor,
  } = useRefinementList({ attribute: "color", limit: 50, sortBy: ["name:asc"] });
  const {
    items: stateItems,
    refine: refineState,
  } = useRefinementList({ attribute: "state", limit: 60, sortBy: ["name:asc"] });
  const {
    items: locationItems,
    refine: refineLocation,
  } = useRefinementList({
    attribute: "locationName",
    limit: 100,
    sortBy: ["name:asc"],
  });

  // Year range
  const { range: yearBounds, start: yearStart, refine: refineYear } = useRange({
    attribute: "year",
  });

  // Sort state (client-side since we don't have replicas)
  const [sortBy, setSortBy] = useState("newest");

  // ── Derived state ──────────────────────────────────────────────────────

  // Map Algolia hits to Vehicle[]
  const vehicles = useMemo(
    () => hits.map((hit) => algoliaHitToVehicle(hit as Record<string, unknown>, userLocation)),
    [hits, userLocation],
  );

  // Client-side sort
  const sortedVehicles = useMemo(() => {
    const sorted = [...vehicles];
    switch (sortBy) {
      case "newest":
        return sorted.sort(
          (a, b) =>
            new Date(b.availableDate).getTime() -
            new Date(a.availableDate).getTime(),
        );
      case "oldest":
        return sorted.sort(
          (a, b) =>
            new Date(a.availableDate).getTime() -
            new Date(b.availableDate).getTime(),
        );
      case "year-desc":
        return sorted.sort((a, b) => b.year - a.year);
      case "year-asc":
        return sorted.sort((a, b) => a.year - b.year);
      case "distance":
        return sorted.sort(
          (a, b) => a.location.distance - b.location.distance,
        );
      default:
        return sorted;
    }
  }, [vehicles, sortBy]);

  // Build filter options from Algolia facets
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
    () => makeItems.filter((i) => i.isRefined).map((i) => i.value),
    [makeItems],
  );
  const selectedColors = useMemo(
    () => colorItems.filter((i) => i.isRefined).map((i) => i.value),
    [colorItems],
  );
  const selectedStates = useMemo(
    () => stateItems.filter((i) => i.isRefined).map((i) => i.value),
    [stateItems],
  );
  const selectedLocations = useMemo(
    () => locationItems.filter((i) => i.isRefined).map((i) => i.value),
    [locationItems],
  );

  const yearMin = (yearBounds.min ?? 1900) as number;
  const yearMax = (yearBounds.max ?? currentYear) as number;
  const yearRange: [number, number] = [
    (yearStart[0] != null && yearStart[0] !== -Infinity) ? yearStart[0] as number : yearMin,
    (yearStart[1] != null && yearStart[1] !== Infinity) ? yearStart[1] as number : yearMax,
  ];
  const isYearFiltered =
    yearRange[0] !== yearMin || yearRange[1] !== yearMax;

  const activeFilterCount =
    selectedMakes.length +
    selectedColors.length +
    selectedStates.length +
    selectedLocations.length +
    (isYearFiltered ? 1 : 0);

  // Build search result object for SearchResults/SearchSummary components
  const searchResult: SearchResultType | null = useMemo(() => {
    if (!query && hits.length === 0) return null;
    return {
      vehicles: sortedVehicles,
      totalCount: nbHits,
      page: 1,
      hasMore: !isLastPage,
      searchTime: processingTimeMS,
      locationsCovered: 0,
      locationsWithErrors: [],
    };
  }, [sortedVehicles, nbHits, isLastPage, processingTimeMS, query, hits.length]);

  const isSearching = query.length > 0 && hits.length === 0 && nbHits === 0;

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleQueryChange = useCallback(
    (newQuery: string) => {
      setQuery(newQuery);
    },
    [setQuery],
  );

  const handleSearch = useCallback(() => {
    // InstantSearch searches as you type, but this satisfies the interface
  }, []);

  // Update search state ref for docked search bar
  searchStateRef.current = {
    query,
    onChange: handleQueryChange,
    onSearch: handleSearch,
  };

  const handleSortChange = useCallback(
    (value: string) => {
      posthog.capture(AnalyticsEvents.SORT_CHANGED, { sort_option: value });
      setSortBy(value);
    },
    [],
  );

  const handleToggleFilters = useCallback(
    () => setShowFilters((prev) => !prev),
    [],
  );

  const clearAllFilters = useCallback(() => {
    posthog.capture(AnalyticsEvents.FILTERS_CLEARED, {
      previous_filter_count: activeFilterCount,
    });
    // Clear all refinements
    for (const item of makeItems.filter((i) => i.isRefined)) {
      refineMake(item.value);
    }
    for (const item of colorItems.filter((i) => i.isRefined)) {
      refineColor(item.value);
    }
    for (const item of stateItems.filter((i) => i.isRefined)) {
      refineState(item.value);
    }
    for (const item of locationItems.filter((i) => i.isRefined)) {
      refineLocation(item.value);
    }
    refineYear([yearMin, yearMax]);
    setSortBy("newest");
    setShowFilters(false);
  }, [
    activeFilterCount,
    makeItems,
    colorItems,
    stateItems,
    locationItems,
    refineMake,
    refineColor,
    refineState,
    refineLocation,
    refineYear,
    yearMin,
    yearMax,
  ]);

  // Filter change handlers that toggle individual values
  const handleMakesChange = useCallback(
    (newMakes: string[]) => {
      const current = new Set(selectedMakes);
      const next = new Set(newMakes);
      // Find what was added or removed
      for (const m of current) {
        if (!next.has(m)) refineMake(m); // uncheck
      }
      for (const m of next) {
        if (!current.has(m)) refineMake(m); // check
      }
    },
    [selectedMakes, refineMake],
  );

  const handleColorsChange = useCallback(
    (newColors: string[]) => {
      const current = new Set(selectedColors);
      const next = new Set(newColors);
      for (const c of current) {
        if (!next.has(c)) refineColor(c);
      }
      for (const c of next) {
        if (!current.has(c)) refineColor(c);
      }
    },
    [selectedColors, refineColor],
  );

  const handleStatesChange = useCallback(
    (newStates: string[]) => {
      const current = new Set(selectedStates);
      const next = new Set(newStates);
      for (const s of current) {
        if (!next.has(s)) refineState(s);
      }
      for (const s of next) {
        if (!current.has(s)) refineState(s);
      }
    },
    [selectedStates, refineState],
  );

  const handleLocationsChange = useCallback(
    (newLocations: string[]) => {
      const current = new Set(selectedLocations);
      const next = new Set(newLocations);
      for (const l of current) {
        if (!next.has(l)) refineLocation(l);
      }
      for (const l of next) {
        if (!current.has(l)) refineLocation(l);
      }
    },
    [selectedLocations, refineLocation],
  );

  const handleSourcesChange = useCallback((_sources: DataSource[]) => {
    // Source filtering is handled via Algolia facet if needed;
    // for now, both sources are in the single index
  }, []);

  const handleYearRangeChange = useCallback(
    (range: [number, number]) => {
      refineYear(range);
    },
    [refineYear],
  );

  // Track search outcomes
  useEffect(() => {
    if (!query || isSearching) return;
    if (lastTrackedQuery.current === query) return;
    lastTrackedQuery.current = query;

    const ctx = buildSearchContext(
      query,
      nbHits,
      processingTimeMS,
      0,
    );

    if (nbHits === 0) {
      posthog.capture(AnalyticsEvents.SEARCH_EMPTY, ctx);
    } else {
      posthog.capture(AnalyticsEvents.SEARCH_COMPLETED, ctx);
    }
  }, [query, isSearching, nbHits, processingTimeMS]);

  // Keyboard shortcuts
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        document.getElementById("search")?.focus();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
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
  useEffect(() => {
    if (isLastPage) return;

    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const windowHeight = window.innerHeight;
      const docHeight = document.documentElement.scrollHeight;

      if (docHeight - scrollTop - windowHeight < 800) {
        showMore();
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isLastPage, showMore]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
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
              sources={[]}
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
                      sources={[]}
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
                  <span>
                    Results in {processingTimeMS}ms
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {/* Empty State */}
          {!query && !isSearching && (
            <div className="py-8 sm:py-12">
              <div className="sm:hidden">
                <h1 className="text-foreground mb-2 text-3xl font-bold tracking-tight">
                  Find Your Parts
                </h1>
                <p className="text-muted-foreground mb-6 text-base">
                  Search across all available salvage yard locations
                </p>
                <div className="mb-8 flex flex-wrap gap-3">
                  <Link
                    href="/search?q=Honda+Civic"
                    className="bg-muted hover:bg-muted/80 text-foreground inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition-colors"
                  >
                    Honda Civic
                  </Link>
                  <Link
                    href="/search?q=2020+Toyota"
                    className="bg-muted hover:bg-muted/80 text-foreground inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition-colors"
                  >
                    2020 Toyota
                  </Link>
                  <Link
                    href="/search?q=Ford+F-150"
                    className="bg-muted hover:bg-muted/80 text-foreground inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition-colors"
                  >
                    Ford F-150
                  </Link>
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
          {(searchResult ?? isSearching) && (
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
              isLoading={isSearching}
              sidebarOpen={!isMobile && showFilters}
            />
          )}

          {/* No Results */}
          {query &&
            searchResult?.totalCount === 0 &&
            !isSearching && (
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
 * Main SearchPageContent — wraps everything in InstantSearch provider.
 */
export function SearchPageContent({ isLoggedIn, userLocation }: SearchPageContentProps) {
  // Build aroundLatLng string for Algolia geo-sort
  const aroundLatLng = userLocation
    ? `${userLocation.lat}, ${userLocation.lng}`
    : undefined;

  return (
    <InstantSearch
      searchClient={searchClient}
      indexName={ALGOLIA_INDEX_NAME}
      future={{ preserveSharedStateOnUnmount: true }}
    >
      <Configure
        hitsPerPage={60}
        aroundLatLng={aroundLatLng}
        aroundLatLngViaIP={!userLocation}
      />
      <AlgoliaSearchInner isLoggedIn={isLoggedIn} userLocation={userLocation} />
    </InstantSearch>
  );
}
