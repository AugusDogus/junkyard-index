"use client";

import { AlertCircle, Search } from "lucide-react";
import Link from "next/link";
import { useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
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
import { useSearchFilters } from "~/hooks/use-search-filters";
import { ERROR_MESSAGES, SEARCH_CONFIG } from "~/lib/constants";
import type { Vehicle } from "~/lib/types";
import { api } from "~/trpc/react";

interface SearchPageContentProps {
  isLoggedIn?: boolean;
}

export function SearchPageContent({ isLoggedIn }: SearchPageContentProps) {
  const [query, setQuery] = useQueryState("q", { defaultValue: "" });
  const currentYear = new Date().getFullYear();
  const isMobile = useIsMobile();
  const { searchStateRef } = useSearchVisibility();

  // Prefetch saved searches early to avoid waterfall
  api.savedSearches.list.useQuery(undefined, {
    enabled: isLoggedIn,
  });

  // Sidebar state (local only - not in URL)
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
  // Polar adds customer_session_token to the URL after successful checkout
  const [subscriptionParam, setSubscriptionParam] =
    useQueryState("subscription");
  const [customerSessionToken, setCustomerSessionToken] =
    useQueryState("customer_session_token");

  useEffect(() => {
    // Check for either subscription=success OR customer_session_token (Polar's redirect)
    const isCheckoutSuccess =
      subscriptionParam === "success" || customerSessionToken;

    if (isCheckoutSuccess) {
      toast.success(
        "Subscription activated! Email alerts are now enabled for your saved searches.",
      );

      // Clear the URL params
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

  // Keyboard shortcut: Cmd/Ctrl+K to focus search
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

  // Keyboard shortcut: F to toggle filters (when not in input)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }

      if (e.key === "f" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShowFilters((prev) => !prev);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Debounce the query for search API calls
  const [debouncedQuery] = useDebounce(query, SEARCH_CONFIG.DEBOUNCE_DELAY);

  // Perform search with debounced query - filtering is done client-side
  // Note: sources filter is handled by the hook below, but we need it for the query
  // We use a separate query state here to avoid circular dependency
  const {
    data: searchResults,
    isLoading: searchLoading,
    error: searchError,
    refetch: refetchSearch,
  } = api.vehicles.search.useQuery(
    {
      query: debouncedQuery,
      makes: undefined,
      colors: undefined,
      states: undefined,
      sources: undefined, // Sources handled client-side for now
      yearRange: undefined,
    },
    {
      enabled: debouncedQuery.length > 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );

  // Use the search filters hook with actual search results
  const filters = useSearchFilters(searchResults?.vehicles, currentYear);

  const handleSearch = () => {
    void refetchSearch();
  };

  const handleQueryChange = useCallback(
    (newQuery: string) => {
      void setQuery(newQuery);
    },
    [setQuery],
  );

  // Update search state ref for docked search bar
  searchStateRef.current = {
    query,
    onChange: handleQueryChange,
    onSearch: handleSearch,
  };

  // Memoized sort handler for filter state
  const handleSortChange = useCallback(
    (value: string) => filters.setSortBy(value),
    [filters],
  );

  // Memoized filter toggle handler
  const handleToggleFilters = useCallback(
    () => setShowFilters((prev) => !prev),
    [],
  );

  // Clear all filters and close sidebar
  const clearAllFilters = useCallback(() => {
    filters.clearAllFilters();
    setShowFilters(false);
  }, [filters]);

  // Sorting function
  const sortVehicles = useCallback(
    (vehicles: Vehicle[], sortOption: string) => {
      const sorted = [...vehicles];

      switch (sortOption) {
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
    },
    [],
  );

  // Create filtered and sorted search result
  const filteredSearchResult = useMemo(() => {
    if (!searchResults) return null;

    const sortedVehicles = sortVehicles(
      filters.filteredVehicles,
      filters.sortBy,
    );

    return {
      ...searchResults,
      vehicles: sortedVehicles,
      totalCount: sortedVehicles.length,
    };
  }, [searchResults, filters.filteredVehicles, filters.sortBy, sortVehicles]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-8 lg:px-8">
      {/* Search Input - sticky with scroll-linked scaling */}
      <MorphingSearchBar />

      <div className="relative flex w-full gap-6">
        {/* Desktop Sidebar - only render when filters are shown and not on mobile */}
        {!isMobile && showFilters && (
          <div className="sticky top-24 h-fit max-h-[calc(100vh-112px)] overflow-y-auto">
            <Sidebar
              showFilters={showFilters}
              setShowFilters={setShowFilters}
              activeFilterCount={filters.activeFilterCount}
              clearAllFilters={clearAllFilters}
              makes={filters.makes}
              colors={filters.colors}
              states={filters.states}
              salvageYards={filters.salvageYards}
              sources={filters.typedSources}
              yearRange={filters.yearRange}
              filterOptions={filters.filterOptions}
              onMakesChange={filters.setMakes}
              onColorsChange={filters.setColors}
              onStatesChange={filters.setStates}
              onSalvageYardsChange={filters.setSalvageYards}
              onSourcesChange={filters.setSources}
              onYearRangeChange={(range: [number, number]) => {
                filters.setMinYear(range[0]);
                filters.setMaxYear(range[1]);
              }}
              yearRangeLimits={{
                min: filters.dataMinYear,
                max: currentYear,
              }}
            />
          </div>
        )}

        {/* Main Content */}
        <div className="w-full flex-1">
          {/* Search Results Header */}
          {(searchLoading || filteredSearchResult) && (
            <div className="mb-6">
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                {/* Title and count - show skeleton when loading */}
                {searchLoading && !filteredSearchResult ? (
                  <div>
                    <Skeleton className="mb-2 h-8 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ) : filteredSearchResult ? (
                  <div>
                    <h2 className="text-foreground text-2xl font-black">
                      Search Results
                    </h2>
                    <p className="text-muted-foreground">
                      {filteredSearchResult.totalCount.toLocaleString()}{" "}
                      vehicles found
                      {filteredSearchResult.totalCount !==
                        searchResults?.totalCount && (
                        <span className="text-muted-foreground text-sm">
                          {" "}
                          (filtered from{" "}
                          {searchResults?.totalCount.toLocaleString()})
                        </span>
                      )}
                    </p>
                  </div>
                ) : null}

                {/* Filter buttons - always rendered so morphing position is consistent */}
                {isMobile ? (
                  <div className="flex items-center gap-2">
                    {isLoggedIn && <SavedSearchesDropdown />}
                    <SaveSearchDialog
                      query={query}
                      filters={{
                        makes: filters.makes,
                        colors: filters.colors,
                        states: filters.states,
                        salvageYards: filters.salvageYards,
                        minYear: filters.yearRange[0],
                        maxYear: filters.yearRange[1],
                        sortBy: filters.sortBy,
                      }}
                      disabled={!query}
                      isLoggedIn={isLoggedIn}
                      autoOpen={autoOpenSaveDialog}
                      onAutoOpenHandled={handleAutoOpenHandled}
                    />
                    <MobileFiltersDrawer
                      activeFilterCount={filters.activeFilterCount}
                      clearAllFilters={clearAllFilters}
                      makes={filters.makes}
                      colors={filters.colors}
                      states={filters.states}
                      salvageYards={filters.salvageYards}
                      sources={filters.typedSources}
                      yearRange={filters.yearRange}
                      filterOptions={filters.filterOptions}
                      onMakesChange={filters.setMakes}
                      onColorsChange={filters.setColors}
                      onStatesChange={filters.setStates}
                      onSalvageYardsChange={filters.setSalvageYards}
                      onSourcesChange={filters.setSources}
                      onYearRangeChange={(range: [number, number]) => {
                        filters.setMinYear(range[0]);
                        filters.setMaxYear(range[1]);
                      }}
                      yearRangeLimits={{
                        min: filters.dataMinYear,
                        max: currentYear,
                      }}
                    />
                  </div>
                ) : (
                  <MorphingFilterBar
                    query={query}
                    sortBy={filters.sortBy}
                    onSortChange={handleSortChange}
                    activeFilterCount={filters.activeFilterCount}
                    showFilters={showFilters}
                    onToggleFilters={handleToggleFilters}
                    isLoggedIn={isLoggedIn}
                    filters={{
                      makes: filters.makes,
                      colors: filters.colors,
                      states: filters.states,
                      salvageYards: filters.salvageYards,
                      minYear: filters.yearRange[0],
                      maxYear: filters.yearRange[1],
                      sortBy: filters.sortBy,
                    }}
                    autoOpenSaveDialog={autoOpenSaveDialog}
                    onAutoOpenHandled={handleAutoOpenHandled}
                    disabled={!query}
                    loading={searchLoading && !filteredSearchResult}
                  />
                )}
              </div>

              {/* Search Stats - show skeleton when loading */}
              {searchLoading && !filteredSearchResult ? (
                <div className="mb-6 flex items-center justify-between text-sm">
                  <Skeleton className="h-4 w-48" />
                </div>
              ) : filteredSearchResult ? (
                <div className="text-muted-foreground mb-6 flex items-center justify-between text-sm">
                  <span>
                    Searched {searchResults?.locationsCovered} locations in{" "}
                    {searchResults?.searchTime}ms
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {/* Error Message */}
          {searchError && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Search Error</AlertTitle>
              <AlertDescription>
                {searchError.message || ERROR_MESSAGES.SEARCH_FAILED}
              </AlertDescription>
            </Alert>
          )}

          {/* Empty State */}
          {!debouncedQuery && !searchLoading && (
            <div className="py-8 sm:py-12">
              {/* Mobile: App-like layout */}
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

              {/* Desktop: Centered layout */}
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
          {(filteredSearchResult ?? searchLoading) && (
            <SearchResults
              searchResult={
                filteredSearchResult ?? {
                  vehicles: [],
                  totalCount: 0,
                  page: 1,
                  hasMore: false,
                  searchTime: 0,
                  locationsCovered: 0,
                  locationsWithErrors: [],
                }
              }
              isLoading={searchLoading}
              sidebarOpen={!isMobile && showFilters}
            />
          )}

          {/* No Results */}
          {debouncedQuery &&
            filteredSearchResult?.totalCount === 0 &&
            !searchLoading && (
              <div className="py-12 text-center">
                <div className="bg-muted mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full">
                  <AlertCircle className="text-muted-foreground h-12 w-12" />
                </div>
                <h2 className="text-foreground mb-2 text-lg font-medium">
                  No vehicles found
                </h2>
                <p className="text-muted-foreground mx-auto mb-6 max-w-md">
                  {searchResults?.totalCount === 0
                    ? "No vehicles match your search. Try different search terms."
                    : "No vehicles match your current filters. Try adjusting your filters."}
                </p>
                {filters.activeFilterCount > 0 && (
                  <Button onClick={clearAllFilters} variant="outline">
                    Clear All Filters
                  </Button>
                )}
              </div>
            )}
        </div>
      </div>

      {filteredSearchResult && (
        <SearchSummary searchResult={filteredSearchResult} />
      )}
    </div>
  );
}
