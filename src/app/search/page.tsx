"use client";

import {
  AlertCircle,
  ArrowUpDown,
  Calendar,
  Filter,
  MapPin,
  Search,
} from "lucide-react";
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  useQueryState,
} from "nuqs";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { MobileFiltersDrawer } from "~/components/search/MobileFiltersDrawer";
import { SearchInput } from "~/components/search/SearchInput";
import {
  SearchResults,
  SearchSummary,
} from "~/components/search/SearchResults";
import { Sidebar } from "~/components/search/Sidebar";
import { ThemeToggle } from "~/components/theme/theme-toggle";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { useIsMobile } from "~/hooks/use-media-query";
import { ERROR_MESSAGES, SEARCH_CONFIG } from "~/lib/constants";
import type { Vehicle } from "~/lib/types";
import { api } from "~/trpc/react";

function SearchPageContent() {
  const [query, setQuery] = useQueryState("q", { defaultValue: "" });
  const currentYear = new Date().getFullYear();
  const isMobile = useIsMobile();

  // Sidebar state (local only - not in URL)
  const [showFilters, setShowFilters] = useState(false);

  // Sort state - should be in URL for shareability
  const [sortBy, setSortBy] = useQueryState(
    "sort",
    parseAsString.withDefault("newest"),
  );

  // Get the appropriate icon for the current sort option
  const getSortIcon = useCallback((sortOption: string) => {
    switch (sortOption) {
      case "newest":
      case "oldest":
        return Calendar;
      case "year-desc":
      case "year-asc":
        return ArrowUpDown;
      case "distance":
        return MapPin;
      default:
        return ArrowUpDown;
    }
  }, []);

  // URL state for year range using built-in integer parser
  const [minYearParam, setMinYearParam] = useQueryState(
    "minYear",
    parseAsInteger,
  );
  const [maxYearParam, setMaxYearParam] = useQueryState(
    "maxYear",
    parseAsInteger,
  );

  // Individual filter states using nuqs built-in parsers
  const [makes, setMakes] = useQueryState(
    "makes",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [colors, setColors] = useQueryState(
    "colors",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [states, setStates] = useQueryState(
    "states",
    parseAsArrayOf(parseAsString).withDefault([]),
  );
  const [salvageYards, setSalvageYards] = useQueryState(
    "yards",
    parseAsArrayOf(parseAsString).withDefault([]),
  );

  // Debounce the query for search API calls
  const [debouncedQuery] = useDebounce(query, SEARCH_CONFIG.DEBOUNCE_DELAY);

  // Perform search with debounced query - filtering is done client-side
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
      yearRange: undefined,
    },
    {
      enabled: debouncedQuery.length > 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  );

  // Calculate minimum year from search results
  const dataMinYear = useMemo(() => {
    if (!searchResults?.vehicles || searchResults.vehicles.length === 0) {
      return 1900; // Fallback only when no data
    }

    const years = searchResults.vehicles.map(
      (vehicle: Vehicle) => vehicle.year,
    );
    return Math.min(...years);
  }, [searchResults?.vehicles]);

  // Year range from URL state (user interacts with this directly)
  const yearRange = useMemo(
    (): [number, number] => [
      minYearParam ?? dataMinYear,
      maxYearParam ?? currentYear,
    ],
    [minYearParam, maxYearParam, dataMinYear, currentYear],
  );

  // Custom year range setters that clear URL params when at defaults
  const setMinYear = useCallback(
    (value: number | null) => {
      if (value === dataMinYear) {
        void setMinYearParam(null);
      } else {
        void setMinYearParam(value);
      }
    },
    [dataMinYear, setMinYearParam],
  );

  const setMaxYear = useCallback(
    (value: number | null) => {
      if (value === currentYear) {
        void setMaxYearParam(null);
      } else {
        void setMaxYearParam(value);
      }
    },
    [currentYear, setMaxYearParam],
  );

  const handleSearch = () => {
    void refetchSearch();
  };

  const handleQueryChange = useCallback(
    (newQuery: string) => {
      void setQuery(newQuery);
    },
    [setQuery],
  );

  // Calculate filter options from search results
  const filterOptions = useMemo(() => {
    if (!searchResults?.vehicles || searchResults.vehicles.length === 0) {
      return {
        makes: [],
        colors: [],
        states: [],
        salvageYards: [],
      };
    }

    const makes = [
      ...new Set(
        searchResults.vehicles.map((vehicle: Vehicle) => vehicle.make),
      ),
    ].sort();
    const colors = [
      ...new Set(
        searchResults.vehicles.map((vehicle: Vehicle) => vehicle.color),
      ),
    ].sort();

    // Show all states and yards (no cross-filtering)
    const allStates = Array.from(
      new Set(
        searchResults.vehicles.map(
          (vehicle: Vehicle) => vehicle.location.state,
        ),
      ),
    ).sort();
    const allSalvageYards = Array.from(
      new Set(
        searchResults.vehicles.map((vehicle: Vehicle) => vehicle.location.name),
      ),
    ).sort();

    return {
      makes,
      colors,
      states: allStates,
      salvageYards: allSalvageYards,
    };
  }, [searchResults?.vehicles]);

  const clearAllFilters = () => {
    void setMakes([]);
    void setColors([]);
    void setStates([]);
    void setSalvageYards([]);

    // Clear URL parameters when user explicitly clears all filters
    void setMinYearParam(null);
    void setMaxYearParam(null);
    void setSortBy("newest"); // Reset sort to default
    setShowFilters(false); // Close sidebar
  };

  // Calculate active filter count
  const activeFilterCount = useMemo(() => {
    const dataYearRange: [number, number] =
      searchResults?.vehicles && searchResults.vehicles.length > 0
        ? [dataMinYear, currentYear]
        : [1900, currentYear];

    return (
      makes.length +
      colors.length +
      states.length +
      salvageYards.length +
      (yearRange &&
      (yearRange[0] !== dataYearRange[0] || yearRange[1] !== dataYearRange[1])
        ? 1
        : 0)
    );
  }, [
    makes,
    colors,
    states,
    salvageYards,
    yearRange,
    currentYear,
    searchResults?.vehicles,
    dataMinYear,
  ]);

  // Comprehensive filtering logic - all client-side, no server filtering
  const filteredVehicles = useMemo(() => {
    if (!searchResults?.vehicles) return [];

    return searchResults.vehicles.filter((vehicle: Vehicle) => {
      // Year range filter
      if (
        yearRange &&
        (vehicle.year < yearRange[0] || vehicle.year > yearRange[1])
      ) {
        return false;
      }

      // Make filter
      if (makes.length > 0 && !makes.includes(vehicle.make)) {
        return false;
      }

      // Color filter
      if (colors.length > 0 && !colors.includes(vehicle.color)) {
        return false;
      }

      // State filter
      if (states.length > 0 && !states.includes(vehicle.location.state)) {
        return false;
      }

      // Salvage yard filter
      if (
        salvageYards.length > 0 &&
        !salvageYards.includes(vehicle.location.name)
      ) {
        return false;
      }

      return true;
    });
  }, [searchResults?.vehicles, makes, colors, states, salvageYards, yearRange]);

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

    const sortedVehicles = sortVehicles(filteredVehicles, sortBy);

    return {
      ...searchResults,
      vehicles: sortedVehicles,
      totalCount: sortedVehicles.length,
    };
  }, [searchResults, filteredVehicles, sortBy, sortVehicles]);

  return (
    <div className="bg-background min-h-screen">
      {/* Header */}
      <header className="bg-card border-b shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center">
            <div className="flex items-center space-x-4">
              <h1 className="text-foreground text-xl font-bold">
                PYP Global Search
              </h1>
              <span className="text-muted-foreground hidden text-sm sm:block">
                Search across all locations
              </span>
            </div>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Search Input */}
        <div className="mb-6">
          <SearchInput
            value={query}
            onChange={handleQueryChange}
            onSearch={handleSearch}
            placeholder="Enter year, make, model (e.g., '2018 Honda Civic' or 'Toyota')"
            isLoading={searchLoading}
          />
        </div>

        <div className="relative flex w-full gap-6">
          {/* Desktop Sidebar - only render when filters are shown and not on mobile */}
          {!isMobile && showFilters && (
            <div className="sticky top-6 h-fit">
              <Sidebar
                showFilters={showFilters}
                setShowFilters={setShowFilters}
                activeFilterCount={activeFilterCount}
                clearAllFilters={clearAllFilters}
                makes={makes}
                colors={colors}
                states={states}
                salvageYards={salvageYards}
                yearRange={yearRange}
                filterOptions={filterOptions}
                onMakesChange={setMakes}
                onColorsChange={setColors}
                onStatesChange={setStates}
                onSalvageYardsChange={setSalvageYards}
                onYearRangeChange={(range: [number, number]) => {
                  setMinYear(range[0]);
                  setMaxYear(range[1]);
                }}
                yearRangeLimits={{
                  min: dataMinYear,
                  max: currentYear,
                }}
              />
            </div>
          )}

          {/* Main Content */}
          <div className="w-full flex-1">
            {/* Search Results Header */}
            {searchLoading && !filteredSearchResult ? (
              <SearchResultsHeaderSkeleton />
            ) : filteredSearchResult ? (
              <div className="mb-6">
                <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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

                  <div className="flex items-center gap-4">
                    {/* Sort */}
                    <Select
                      value={sortBy}
                      onValueChange={(value) => setSortBy(value)}
                    >
                      <SelectTrigger className="w-fit">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const IconComponent = getSortIcon(sortBy);
                            return (
                              <IconComponent className="text-muted-foreground h-4 w-4" />
                            );
                          })()}
                          <SelectValue />
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="newest">Newest First</SelectItem>
                        <SelectItem value="oldest">Oldest First</SelectItem>
                        <SelectItem value="year-desc">
                          Year (High to Low)
                        </SelectItem>
                        <SelectItem value="year-asc">
                          Year (Low to High)
                        </SelectItem>
                        <SelectItem value="distance">
                          Distance (Nearest)
                        </SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Filter Toggle Button - Mobile/Desktop */}
                    {isMobile ? (
                      <MobileFiltersDrawer
                        activeFilterCount={activeFilterCount}
                        clearAllFilters={clearAllFilters}
                        makes={makes}
                        colors={colors}
                        states={states}
                        salvageYards={salvageYards}
                        yearRange={yearRange}
                        filterOptions={filterOptions}
                        onMakesChange={setMakes}
                        onColorsChange={setColors}
                        onStatesChange={setStates}
                        onSalvageYardsChange={setSalvageYards}
                        onYearRangeChange={(range: [number, number]) => {
                          setMinYear(range[0]);
                          setMaxYear(range[1]);
                        }}
                        yearRangeLimits={{
                          min: dataMinYear,
                          max: currentYear,
                        }}
                      />
                    ) : (
                      <Button
                        variant="outline"
                        className="flex items-center gap-2 bg-transparent"
                        onClick={() => setShowFilters(!showFilters)}
                      >
                        <Filter className="h-4 w-4" />
                        Filters
                        {activeFilterCount > 0 && (
                          <Badge variant="secondary" className="ml-1 text-xs">
                            {activeFilterCount}
                          </Badge>
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Search Stats */}
                <div className="text-muted-foreground mb-6 flex items-center justify-between text-sm">
                  <span>
                    Searched {searchResults?.locationsCovered} locations in{" "}
                    {searchResults?.searchTime}ms
                  </span>
                </div>
              </div>
            ) : null}

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
              <div className="py-12 text-center">
                <div className="bg-muted mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full">
                  <Search className="text-muted-foreground h-12 w-12" />
                </div>
                <h2 className="text-foreground mb-2 text-lg font-medium">
                  Search for vehicles
                </h2>
                <p className="text-muted-foreground mx-auto max-w-md">
                  Enter a year, make, model, or any combination to search across
                  all Pick Your Part locations.
                </p>
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
                  {activeFilterCount > 0 && (
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
    </div>
  );
}

function SearchResultsHeaderSkeleton() {
  return (
    <div className="mb-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton className="mb-2 h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
      <div className="mb-6 flex items-center justify-between text-sm">
        <Skeleton className="h-4 w-48" />
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <ErrorBoundary>
      <Suspense>
        <SearchPageContent />
      </Suspense>
    </ErrorBoundary>
  );
}
