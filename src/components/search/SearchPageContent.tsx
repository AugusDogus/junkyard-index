"use client";

import {
  AlertCircle,
  ArrowUpDown,
  Calendar,
  Filter,
  LocateFixed,
  MapPin,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
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
import { parseAsString, useQueryState } from "nuqs";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { MobileFiltersDrawer } from "~/components/search/MobileFiltersDrawer";
import { MorphingFilterBar } from "~/components/search/MorphingFilterBar";
import { MorphingSearchBar } from "~/components/search/MorphingSearchBar";
import {
  clearPendingSaveSearch,
  SaveSearchDialog,
  storePendingSaveSearch,
} from "~/components/search/SaveSearchDialog";
import { SavedSearchesDropdown } from "~/components/search/SavedSearchesDropdown";
import { SavedSearchesList } from "~/components/search/SavedSearchesList";
import {
  SearchResults,
  SearchSummary,
} from "~/components/search/SearchResults";
import { Sidebar } from "~/components/search/Sidebar";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import {
  createSearchRouting,
  getSearchableVinPattern,
  getSearchSortIndex,
  getSearchSortKey,
  sanitizeSearchSources,
  SEARCH_SORT_ITEMS,
  SEARCH_SORT_OPTIONS,
} from "~/components/search/search-routing";
import { useIsMobile } from "~/hooks/use-media-query";
import { AnalyticsEvents, buildSearchContext } from "~/lib/analytics-events";
import { searchClient, ALGOLIA_INDEX_NAME } from "~/lib/algolia-search";
import { SEARCH_CONFIG } from "~/lib/constants";
import {
  PLANS,
  resolvePlanFeatureAccess,
  resolvedPlanTier,
  type PlanAccessState,
} from "~/lib/plans";
import type { QuotaViewer } from "~/lib/quota-viewer";
import {
  hasFiniteCoordinates,
  LOCATION_PREFERENCE_STORAGE_KEY,
  normalizeZipCode,
  parseStoredLocationPreference,
  type StoredLocationPreference,
} from "~/lib/location-preferences";
import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";
import { getSearchCapabilityPollInterval } from "~/lib/search-capability-polling";
import { cn } from "~/lib/utils";
import type { DataSource, SearchResult as SearchResultType } from "~/lib/types";
import { VinPattern } from "~/lib/vin-pattern";
import { SearchQuotaOverlay } from "~/components/search/SearchQuotaOverlay";
import { useCheckoutConfirmation } from "~/hooks/use-checkout-confirmation";
import { useSearchQuotaGate } from "~/hooks/use-daily-search-quota";
import { usePlanAccess } from "~/hooks/use-plan-access";
import { api } from "~/trpc/react";

function clampRouteYear(
  value: number | null,
  min: number,
  max: number,
): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(max, Math.max(min, value));
}

interface SearchPageContentProps {
  viewer: QuotaViewer;
  userLocation?: { lat: number; lng: number };
}

interface AlgoliaSearchInnerProps {
  viewer: QuotaViewer;
  planAccess: PlanAccessState;
  userLocation?: { lat: number; lng: number };
  vinPatternIndexReady: boolean;
}
function hasValidCoordinates(
  value: SearchPageContentProps["userLocation"],
): value is { lat: number; lng: number } {
  return Boolean(
    value &&
    Number.isFinite(value.lat) &&
    Number.isFinite(value.lng) &&
    Math.abs(value.lat) <= 90 &&
    Math.abs(value.lng) <= 180,
  );
}

function getSortIcon(sortOption: string) {
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
}

function loadLocalLocationPreference(): StoredLocationPreference | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LOCATION_PREFERENCE_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    return parseStoredLocationPreference(JSON.parse(raw));
  } catch {
    return null;
  }
}

function saveLocalLocationPreference(preference: StoredLocationPreference) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    LOCATION_PREFERENCE_STORAGE_KEY,
    JSON.stringify(preference),
  );
}

function isUsableLocationPreference(
  preference: StoredLocationPreference | null | undefined,
): preference is StoredLocationPreference {
  return (
    preference?.mode === "auto" ||
    (preference?.mode === "zip" &&
      preference.zipCode !== null &&
      hasFiniteCoordinates(preference))
  );
}

interface DistancePreferenceDialogProps {
  open: boolean;
  manualZipCode: string;
  selectedMode: "auto" | "zip";
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onModeChange: (mode: "auto" | "zip") => void;
  onManualZipCodeChange: (value: string) => void;
  onConfirm: () => void;
}

function DistancePreferenceDialog({
  open,
  manualZipCode,
  selectedMode,
  isSubmitting,
  onOpenChange,
  onModeChange,
  onManualZipCodeChange,
  onConfirm,
}: DistancePreferenceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Distance Location</DialogTitle>
          <DialogDescription className="text-pretty">
            Choose how to determine your location when sorting by distance. You
            can change this anytime in Settings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => onModeChange("auto")}
            disabled={isSubmitting}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              selectedMode === "auto"
                ? "border-primary bg-primary/5"
                : "hover:border-muted-foreground/25",
            )}
          >
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md",
                selectedMode === "auto"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <LocateFixed className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium">Automatic</p>
              <p className="text-muted-foreground text-xs text-pretty">
                Approximate location based on your IP address
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onModeChange("zip")}
            disabled={isSubmitting}
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              selectedMode === "zip"
                ? "border-primary bg-primary/5"
                : "hover:border-muted-foreground/25",
            )}
          >
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-md",
                selectedMode === "zip"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <MapPin className="size-4" />
            </div>
            <div>
              <p className="text-sm font-medium">ZIP Code</p>
              <p className="text-muted-foreground text-xs text-pretty">
                Enter a ZIP code for precise distance results
              </p>
            </div>
          </button>

          {selectedMode === "zip" && (
            <Input
              id="distance-zip-code"
              inputMode="numeric"
              autoComplete="postal-code"
              maxLength={5}
              placeholder="e.g. 90210"
              value={manualZipCode}
              onChange={(event) => onManualZipCodeChange(event.target.value)}
              disabled={isSubmitting}
            />
          )}
        </div>

        <DialogFooter>
          <Button onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inner component that uses Algolia hooks (must be inside InstantSearch provider).
 */
function AlgoliaSearchInner({
  viewer,
  planAccess,
  userLocation: _userLocation,
  vinPatternIndexReady,
}: AlgoliaSearchInnerProps) {
  const isLoggedIn = viewer.kind === "authenticated";
  const isAnonymousUser = viewer.kind === "guest";
  const planTier = resolvedPlanTier(planAccess);
  const canUseAdvancedFilters = resolvePlanFeatureAccess({
    access: planAccess,
    feature: "advanced_filters",
  });
  const currentYear = new Date().getFullYear();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useCheckoutConfirmation(planAccess);
  const isMobile = useIsMobile();
  const lastTrackedQuery = useRef("");
  const lastTrackedResultCapQuery = useRef("");
  const [localLocationPreference, setLocalLocationPreference] =
    useState<StoredLocationPreference | null>(null);
  const [
    hasLoadedLocalLocationPreference,
    setHasLoadedLocalLocationPreference,
  ] = useState(false);
  const [browserLocation, setBrowserLocation] =
    useState<SearchPageContentProps["userLocation"]>();
  const [browserGeolocationPermission, setBrowserGeolocationPermission] =
    useState<"granted" | "denied" | "prompt" | "unsupported">("unsupported");
  const [showDistancePreferenceDialog, setShowDistancePreferenceDialog] =
    useState(false);
  const [pendingDistanceSort, setPendingDistanceSort] = useState(false);
  const [selectedDistanceMode, setSelectedDistanceMode] = useState<
    "auto" | "zip"
  >("auto");
  const [manualZipCode, setManualZipCode] = useState("");

  const utils = api.useUtils();
  const {
    data: accountLocationPreference,
    isLoading: isAccountLocationPreferenceLoading,
  } = api.user.getLocationPreference.useQuery(undefined, {
    retry: false,
  });
  const resolveZipCodeMutation = api.user.resolveZipCode.useMutation();
  const updateLocationPreferenceMutation =
    api.user.updateLocationPreference.useMutation({
      onSuccess: async () => {
        await utils.user.getLocationPreference.invalidate();
      },
    });

  useEffect(() => {
    setLocalLocationPreference(loadLocalLocationPreference());
    setHasLoadedLocalLocationPreference(true);
  }, []);

  // Prefetch saved searches
  api.savedSearches.list.useQuery(undefined, { enabled: !!isLoggedIn });

  // Sidebar state
  const [showFilters, setShowFilters] = useState(false);
  const [searchValueParam, setSearchValueParam] = useQueryState(
    "q",
    parseAsString,
  );
  const searchableVinPattern = useMemo(
    () =>
      vinPatternIndexReady ? getSearchableVinPattern(searchValueParam) : null,
    [searchValueParam, vinPatternIndexReady],
  );
  const vinPattern = searchableVinPattern?.normalized ?? "";
  const effectiveVinPatternFilter = searchableVinPattern?.filter;

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

  const handleAutoOpenHandled = useCallback(() => {
    setAutoOpenSaveDialog(false);
  }, []);

  const currentPathWithQuery = useMemo(() => {
    const queryString = searchParams.toString();
    return queryString ? `${pathname}?${queryString}` : pathname;
  }, [pathname, searchParams]);

  const signUpHref = useMemo(
    () => `/auth/sign-up?returnTo=${encodeURIComponent(currentPathWithQuery)}`,
    [currentPathWithQuery],
  );

  const saveSearchSignUpHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("saveSearch", "1");
    return `/auth/sign-up?returnTo=${encodeURIComponent(`${pathname}?${params.toString()}`)}`;
  }, [pathname, searchParams]);

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
    useSortBy({ items: SEARCH_SORT_ITEMS });

  const sortBy = useMemo(
    () => getSearchSortKey(currentSortIndex),
    [currentSortIndex],
  );
  const SortIcon = getSortIcon(sortBy);

  const locationPreferenceReady =
    hasLoadedLocalLocationPreference && !isAccountLocationPreferenceLoading;

  const effectiveLocationPreference = useMemo(() => {
    const accountPreference =
      accountLocationPreference?.hasPreference && accountLocationPreference.mode
        ? ({
            mode: accountLocationPreference.mode,
            zipCode: accountLocationPreference.zipCode,
            lat: accountLocationPreference.lat,
            lng: accountLocationPreference.lng,
          } satisfies StoredLocationPreference)
        : null;

    if (isUsableLocationPreference(accountPreference)) {
      return accountPreference;
    }

    if (isUsableLocationPreference(localLocationPreference)) {
      return localLocationPreference;
    }

    return null;
  }, [accountLocationPreference, localLocationPreference]);
  const hasUsableLocationPreference = isUsableLocationPreference(
    effectiveLocationPreference,
  );

  const isDistanceSort = sortBy === "distance";
  const shouldUseBrowserFallback =
    isDistanceSort &&
    effectiveLocationPreference?.mode === "auto" &&
    browserGeolocationPermission === "granted" &&
    !hasValidCoordinates(browserLocation);

  useEffect(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setBrowserGeolocationPermission("denied");
      return;
    }

    if (!("permissions" in navigator)) {
      setBrowserGeolocationPermission("unsupported");
      return;
    }

    let cancelled = false;

    void navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        const syncState = () => {
          if (cancelled) return;

          if (
            status.state === "granted" ||
            status.state === "denied" ||
            status.state === "prompt"
          ) {
            setBrowserGeolocationPermission(status.state);
            return;
          }

          setBrowserGeolocationPermission("unsupported");
        };

        syncState();
        status.onchange = syncState;
      })
      .catch(() => {
        if (cancelled) return;
        setBrowserGeolocationPermission("unsupported");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!shouldUseBrowserFallback) {
      return;
    }

    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return;
          setBrowserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => {
          if (cancelled) return;
          setBrowserLocation(undefined);
        },
        {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 15 * 60 * 1000,
        },
      );
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [shouldUseBrowserFallback]);

  const resolvedUserLocation = useMemo(() => {
    if (
      effectiveLocationPreference?.mode === "zip" &&
      hasFiniteCoordinates(effectiveLocationPreference)
    ) {
      return {
        lat: effectiveLocationPreference.lat,
        lng: effectiveLocationPreference.lng,
      };
    }

    if (
      effectiveLocationPreference?.mode === "auto" &&
      hasValidCoordinates(browserLocation)
    ) {
      return browserLocation;
    }

    return undefined;
  }, [browserLocation, effectiveLocationPreference]);
  // ── Derived state ──────────────────────────────────────────────────────

  // Map Algolia hits to search-display vehicles.
  const vehicles = useMemo(
    () =>
      hits.flatMap((hit) => {
        const vehicle = algoliaHitToSearchVehicle(
          hit as Record<string, unknown>,
          resolvedUserLocation,
        );
        return vehicle ? [vehicle] : [];
      }),
    [hits, resolvedUserLocation],
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
    () => sanitizeSearchSources(refinementList.source ?? []),
    [refinementList],
  );

  const parsedRouteYears = (yearRangeState.year ?? "")
    .split(":")
    .map((value) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    });
  const rawRouteMinYear = parsedRouteYears[0] ?? null;
  const rawRouteMaxYear = parsedRouteYears[1] ?? null;

  const yearMin: number =
    typeof yearBounds.min === "number" &&
    Number.isFinite(yearBounds.min) &&
    yearBounds.min > 0
      ? yearBounds.min
      : 1900;
  const yearMax: number =
    typeof yearBounds.max === "number" &&
    Number.isFinite(yearBounds.max) &&
    yearBounds.max > 0
      ? yearBounds.max
      : currentYear;
  let routeMinYear = clampRouteYear(rawRouteMinYear, yearMin, yearMax);
  let routeMaxYear = clampRouteYear(rawRouteMaxYear, yearMin, yearMax);
  if (
    routeMinYear !== null &&
    routeMaxYear !== null &&
    routeMinYear > routeMaxYear
  ) {
    [routeMinYear, routeMaxYear] = [routeMaxYear, routeMinYear];
  }
  const yearRange: [number, number] = [
    routeMinYear ??
      clampRouteYear(
        Number.isFinite(yearStart[0]) ? (yearStart[0] as number) : yearMin,
        yearMin,
        yearMax,
      ) ??
      yearMin,
    routeMaxYear ??
      clampRouteYear(
        Number.isFinite(yearStart[1]) ? (yearStart[1] as number) : yearMax,
        yearMin,
        yearMax,
      ) ??
      yearMax,
  ];
  const isYearFiltered = yearRange[0] !== yearMin || yearRange[1] !== yearMax;

  const activeFilterCount =
    selectedMakes.length +
    selectedColors.length +
    selectedStates.length +
    selectedLocations.length +
    selectedSources.length +
    (isYearFiltered ? 1 : 0);

  const currentSaveSearchFilters = useMemo(
    () => ({
      vinPattern: effectiveVinPatternFilter ? vinPattern : undefined,
      makes: selectedMakes,
      colors: selectedColors,
      states: selectedStates,
      salvageYards: selectedLocations,
      sources: selectedSources,
      minYear: yearRange[0],
      maxYear: yearRange[1],
      sortBy,
    }),
    [
      selectedMakes,
      selectedColors,
      selectedStates,
      selectedLocations,
      selectedSources,
      yearRange,
      sortBy,
      vinPattern,
      effectiveVinPatternFilter,
    ],
  );

  // VIN searches can run alone from the primary search bar.
  const hasActiveSearch =
    query.length > 0 || Boolean(effectiveVinPatternFilter);
  const analyticsSearchValue = effectiveVinPatternFilter ? vinPattern : query;

  // Loading = Algolia is actively fetching (not stale "0 results")
  const isSearching =
    hasActiveSearch && (status === "loading" || status === "stalled");

  const quotaGate = useSearchQuotaGate({
    initialViewer: viewer,
    planTier,
    analyticsSearchValue,
    hasActiveSearch,
    isSearching,
    hasError: !!error,
  });

  const anonymousVisibleLimit = isMobile
    ? 4
    : SEARCH_CONFIG.ANONYMOUS_VISIBLE_RESULTS_LIMIT;
  const anonymousClearRows = isMobile ? 3 : 1;

  const isAnonymousCapped =
    !isLoggedIn && !isSearching && nbHits > anonymousVisibleLimit;

  const visibleVehicles = useMemo(
    () =>
      isAnonymousCapped ? vehicles.slice(0, anonymousVisibleLimit) : vehicles,
    [isAnonymousCapped, vehicles, anonymousVisibleLimit],
  );

  // Build search result object for SearchResults/SearchSummary components
  const searchResult: SearchResultType | null = useMemo(() => {
    if (!hasActiveSearch) return null;
    if (
      (status === "loading" || status === "stalled" || status === "error") &&
      hits.length === 0
    )
      return null;
    return {
      vehicles: visibleVehicles,
      totalCount: nbHits,
      page: 1,
      hasMore: isAnonymousCapped ? false : !isLastPage,
      searchTime: processingTimeMS,
      locationsCovered: 0,
      locationsWithErrors: [],
    };
  }, [
    visibleVehicles,
    nbHits,
    isLastPage,
    processingTimeMS,
    hasActiveSearch,
    status,
    hits.length,
    isAnonymousCapped,
  ]);

  const anonymousResultsOverlay = useMemo(() => {
    if (!isAnonymousCapped || !searchResult) {
      return null;
    }

    return (
      <div className="bg-card mx-auto w-full max-w-2xl rounded-lg border p-6 text-left shadow-lg">
        <p className="text-sm font-medium">Want the rest of the results?</p>
        <h3 className="mt-2 text-xl font-semibold tracking-tight text-balance">
          Create a free account to unlock full search results.
        </h3>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm text-pretty">
          You can keep searching for free, upgrade to Lite for $
          {PLANS.lite.monthlyPrice}/mo to unlock filters and saved searches, or
          go Full for ${PLANS.full.monthlyPrice}/mo to get email and Discord
          alerts when new matches arrive.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Button asChild>
            <Link
              href={signUpHref}
              onClick={() =>
                posthog.capture(AnalyticsEvents.RESULT_CAP_SIGNUP_CLICKED, {
                  source_page: "search",
                  cta_location: "result_cap",
                  query: analyticsSearchValue,
                  result_count: searchResult.totalCount,
                  visible_result_count: anonymousVisibleLimit,
                })
              }
            >
              Create Free Account
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link
              href="/pricing"
              onClick={() =>
                posthog.capture(AnalyticsEvents.RESULT_CAP_PRICING_CLICKED, {
                  source_page: "search",
                  cta_location: "result_cap",
                  query: analyticsSearchValue,
                  result_count: searchResult.totalCount,
                  visible_result_count: anonymousVisibleLimit,
                })
              }
            >
              See Pricing
            </Link>
          </Button>
        </div>
      </div>
    );
  }, [isAnonymousCapped, analyticsSearchValue, searchResult, signUpHref]);

  const showQuotaBlock = quotaGate.kind !== "open";

  // ── Handlers ───────────────────────────────────────────────────────────

  const applyDistancePreference = useCallback(
    async (mode: "auto" | "zip") => {
      if (mode === "auto") {
        const preference: StoredLocationPreference = {
          mode: "auto",
          zipCode: null,
          lat: null,
          lng: null,
        };

        if (isLoggedIn) {
          await updateLocationPreferenceMutation.mutateAsync({ mode: "auto" });
        }

        saveLocalLocationPreference(preference);
        setLocalLocationPreference(preference);

        return;
      }

      const normalizedZipCode = normalizeZipCode(manualZipCode);
      if (!normalizedZipCode) {
        throw new Error("Enter a valid 5-digit ZIP code.");
      }

      if (isLoggedIn) {
        const preference = await updateLocationPreferenceMutation.mutateAsync({
          mode: "zip",
          zipCode: normalizedZipCode,
        });
        const localPreference: StoredLocationPreference = {
          mode: "zip",
          zipCode: preference.zipCode,
          lat: preference.lat,
          lng: preference.lng,
        };
        saveLocalLocationPreference(localPreference);
        setLocalLocationPreference(localPreference);
        return;
      }

      const resolved = await resolveZipCodeMutation.mutateAsync({
        zipCode: normalizedZipCode,
      });
      const preference: StoredLocationPreference = {
        mode: "zip",
        zipCode: resolved.zipCode,
        lat: resolved.lat,
        lng: resolved.lng,
      };
      saveLocalLocationPreference(preference);
      setLocalLocationPreference(preference);
    },
    [
      isLoggedIn,
      manualZipCode,
      resolveZipCodeMutation,
      updateLocationPreferenceMutation,
    ],
  );

  const handleDistancePreferenceConfirm = useCallback(async () => {
    try {
      await applyDistancePreference(selectedDistanceMode);
      setShowDistancePreferenceDialog(false);
      toast.success(
        isLoggedIn
          ? "Distance location saved. You can update it later from Settings."
          : "Distance location saved for this browser. You can update it later from account settings.",
      );

      if (pendingDistanceSort) {
        refineSortBy("vehicles_distance");
        setPendingDistanceSort(false);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Could not save your distance location.";
      toast.error(message);
    }
  }, [
    applyDistancePreference,
    isLoggedIn,
    pendingDistanceSort,
    refineSortBy,
    selectedDistanceMode,
  ]);

  const handleSortChange = useCallback(
    (value: string) => {
      if (value === "distance") {
        if (!locationPreferenceReady) {
          return;
        }

        if (!hasUsableLocationPreference) {
          setSelectedDistanceMode("auto");
          setManualZipCode("");
          setPendingDistanceSort(true);
          setShowDistancePreferenceDialog(true);
          return;
        }
      }

      posthog.capture(AnalyticsEvents.SORT_CHANGED, { sort_option: value });
      refineSortBy(getSearchSortIndex(value));
    },
    [
      hasUsableLocationPreference,
      locationPreferenceReady,
      refineSortBy,
      setManualZipCode,
      setPendingDistanceSort,
      setShowDistancePreferenceDialog,
    ],
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

  const handleSearchModeChange = useCallback(
    async (value: { query: string | null; vinPattern: string | null }) => {
      await setSearchValueParam(
        value.vinPattern ? VinPattern.normalize(value.vinPattern) : value.query,
      );
    },
    [setSearchValueParam],
  );

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
    if (!analyticsSearchValue || isSearching || error) return;
    if (lastTrackedQuery.current === analyticsSearchValue) return;
    lastTrackedQuery.current = analyticsSearchValue;

    const ctx = buildSearchContext(
      analyticsSearchValue,
      nbHits,
      processingTimeMS,
      0,
    );

    if (nbHits === 0) {
      posthog.capture(AnalyticsEvents.SEARCH_EMPTY, ctx);
    } else {
      posthog.capture(AnalyticsEvents.SEARCH_COMPLETED, ctx);
    }
  }, [analyticsSearchValue, isSearching, error, nbHits, processingTimeMS]);

  useEffect(() => {
    if (!analyticsSearchValue || !isAnonymousCapped || isSearching || error)
      return;
    if (lastTrackedResultCapQuery.current === analyticsSearchValue) return;
    lastTrackedResultCapQuery.current = analyticsSearchValue;

    posthog.capture(AnalyticsEvents.RESULT_CAP_REACHED, {
      source_page: "search",
      query: analyticsSearchValue,
      query_length: analyticsSearchValue.trim().length,
      result_count: nbHits,
      visible_result_count: anonymousVisibleLimit,
      is_logged_in: false,
    });
  }, [
    analyticsSearchValue,
    isAnonymousCapped,
    isSearching,
    error,
    nbHits,
    anonymousVisibleLimit,
  ]);

  useEffect(() => {
    if (!locationPreferenceReady) {
      return;
    }

    if (sortBy !== "distance" || hasUsableLocationPreference) {
      return;
    }

    setSelectedDistanceMode("auto");
    setManualZipCode("");
    setPendingDistanceSort(true);
    setShowDistancePreferenceDialog(true);
    refineSortBy(ALGOLIA_INDEX_NAME);
  }, [
    hasUsableLocationPreference,
    locationPreferenceReady,
    refineSortBy,
    sortBy,
  ]);

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
  const aroundLatLng =
    isDistanceSort && resolvedUserLocation
      ? `${resolvedUserLocation.lat}, ${resolvedUserLocation.lng}`
      : undefined;
  const useAlgoliaIpLocation =
    isDistanceSort &&
    effectiveLocationPreference?.mode === "auto" &&
    !resolvedUserLocation;

  const mobileFiltersDrawer = (
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
      canUseAdvancedFilters={canUseAdvancedFilters}
      iconOnly={hasActiveSearch}
    />
  );

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
        aroundLatLngViaIP={useAlgoliaIpLocation}
        aroundRadius={isDistanceSort ? "all" : undefined}
        filters={effectiveVinPatternFilter}
      />
      <DistancePreferenceDialog
        open={showDistancePreferenceDialog}
        manualZipCode={manualZipCode}
        selectedMode={selectedDistanceMode}
        isSubmitting={
          resolveZipCodeMutation.isPending ||
          updateLocationPreferenceMutation.isPending
        }
        onOpenChange={(open) => {
          setShowDistancePreferenceDialog(open);
          if (!open) {
            setPendingDistanceSort(false);
          }
        }}
        onModeChange={setSelectedDistanceMode}
        onManualZipCodeChange={setManualZipCode}
        onConfirm={() => {
          void handleDistancePreferenceConfirm();
        }}
      />
      <ErrorBoundary>
        <MorphingSearchBar
          vinPattern={vinPattern}
          vinPatternSearchReady={vinPatternIndexReady}
          onSearchModeChange={handleSearchModeChange}
        />
      </ErrorBoundary>

      {!hasActiveSearch && !isSearching && (
        <div className="mb-4 flex justify-end">
          {isMobile ? (
            mobileFiltersDrawer
          ) : !showFilters ? (
            <Button variant="outline" onClick={() => setShowFilters(true)}>
              <Filter data-icon="inline-start" />
              Filters
            </Button>
          ) : null}
        </div>
      )}

      <div className="relative flex w-full gap-4 md:gap-6">
        {/* Desktop Sidebar */}
        {!isMobile && showFilters && (
          <div className="sticky top-24 h-[calc(100vh-112px)] w-64 shrink-0 lg:w-80">
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
              canUseAdvancedFilters={canUseAdvancedFilters}
            />
          </div>
        )}

        {/* Main Content */}
        <div className="min-w-0 flex-1">
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
                      {isAnonymousCapped
                        ? `Showing ${anonymousVisibleLimit} of ${searchResult.totalCount.toLocaleString()} vehicles`
                        : `${searchResult.totalCount.toLocaleString()} vehicles found`}
                    </p>
                  </div>
                ) : null}

                {/* Filter buttons */}
                {isMobile ? (
                  <div className="flex items-center gap-1.5">
                    {isLoggedIn && <SavedSearchesDropdown iconOnly />}
                    <Select value={sortBy} onValueChange={handleSortChange}>
                      <SelectTrigger size="sm" className="w-fit">
                        <SortIcon className="text-muted-foreground h-3.5 w-3.5" />
                      </SelectTrigger>
                      <SelectContent>
                        {SEARCH_SORT_OPTIONS.map(({ key, label }) => (
                          <SelectItem key={key} value={key}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <SaveSearchDialog
                      query={query}
                      filters={currentSaveSearchFilters}
                      planAccess={planAccess}
                      disabled={!hasActiveSearch}
                      isLoggedIn={isLoggedIn}
                      autoOpen={autoOpenSaveDialog}
                      onAutoOpenHandled={handleAutoOpenHandled}
                      iconOnly
                    />
                    {mobileFiltersDrawer}
                  </div>
                ) : (
                  <MorphingFilterBar
                    query={query}
                    planAccess={planAccess}
                    sortBy={sortBy}
                    onSortChange={handleSortChange}
                    activeFilterCount={activeFilterCount}
                    showFilters={showFilters}
                    onToggleFilters={handleToggleFilters}
                    isLoggedIn={isLoggedIn}
                    filters={currentSaveSearchFilters}
                    autoOpenSaveDialog={autoOpenSaveDialog}
                    onAutoOpenHandled={handleAutoOpenHandled}
                    disabled={!hasActiveSearch}
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

          <SearchQuotaOverlay
            gate={quotaGate}
            query={analyticsSearchValue}
            isGuest={!isLoggedIn && !!isAnonymousUser}
          />

          {/* Search Results */}
          {(searchResult ?? isSearching) && !error && !showQuotaBlock && (
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
              isLastPage={isAnonymousCapped ? true : isLastPage}
              isFetchingNextPage={
                isAnonymousCapped
                  ? false
                  : status === "loading" || status === "stalled"
              }
              lockedPreview={
                anonymousResultsOverlay
                  ? {
                      clearRows: anonymousClearRows,
                      overlay: anonymousResultsOverlay,
                    }
                  : undefined
              }
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
          {hasActiveSearch &&
            searchResult?.totalCount === 0 &&
            !isSearching &&
            !error && (
              <div className="py-12 text-center">
                <div className="bg-muted mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <AlertCircle className="text-muted-foreground h-8 w-8" />
                </div>
                <h2 className="text-foreground mb-2 text-lg font-medium">
                  No vehicles found
                </h2>
                <p className="text-muted-foreground mx-auto max-w-sm text-sm">
                  {activeFilterCount > 0
                    ? "No vehicles match your current filters. Try broadening your search."
                    : "No vehicles match your search. Try different terms."}
                </p>

                {activeFilterCount > 0 && (
                  <Button
                    onClick={clearAllFilters}
                    variant="outline"
                    size="sm"
                    className="mt-5"
                  >
                    Clear Filters
                  </Button>
                )}

                <p className="text-muted-foreground mt-6 text-xs">
                  {isLoggedIn ? (
                    <SaveSearchDialog
                      query={query}
                      filters={currentSaveSearchFilters}
                      planAccess={planAccess}
                      disabled={!hasActiveSearch}
                      isLoggedIn={isLoggedIn}
                    />
                  ) : (
                    <Link
                      href={saveSearchSignUpHref}
                      className="hover:text-foreground underline underline-offset-2"
                      onClick={() => {
                        storePendingSaveSearch(query, currentSaveSearchFilters);
                        posthog.capture(
                          AnalyticsEvents.RESULT_CAP_SIGNUP_CLICKED,
                          {
                            source_page: "search",
                            cta_location: "no_results",
                            query: analyticsSearchValue,
                            result_count: 0,
                            visible_result_count: 0,
                          },
                        );
                      }}
                    >
                      Save this search
                    </Link>
                  )}{" "}
                  ·{" "}
                  <Link
                    href="/pricing"
                    className="hover:text-foreground underline underline-offset-2"
                    onClick={() =>
                      posthog.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
                        source_page: "search",
                        cta_location: "no_results",
                        query: analyticsSearchValue,
                        result_count: 0,
                        visible_result_count: 0,
                        is_logged_in: isLoggedIn,
                      })
                    }
                  >
                    Get alerts
                  </Link>
                </p>
              </div>
            )}
        </div>
      </div>

      {searchResult && !showQuotaBlock && (
        <SearchSummary
          searchResult={searchResult}
          visibleCount={isAnonymousCapped ? anonymousVisibleLimit : undefined}
        />
      )}
    </div>
  );
}

const INSTANT_SEARCH_FUTURE = { preserveSharedStateOnUnmount: true } as const;

/**
 * Main SearchPageContent — wraps everything in InstantSearch provider.
 */
export function SearchPageContent({
  viewer,
  userLocation,
}: SearchPageContentProps) {
  const searchParams = useSearchParams();
  const [refreshUntilPaid] = useState(
    () =>
      searchParams.get("subscription") === "success" ||
      searchParams.has("customer_session_token"),
  );
  const isLoggedIn = viewer.kind === "authenticated";
  const planAccess = usePlanAccess(isLoggedIn, {
    refreshUntilPaid,
  });
  const canUseAdvancedFilters = resolvePlanFeatureAccess({
    access: planAccess,
    feature: "advanced_filters",
  });
  const { data: searchCapabilities } = api.status.searchCapabilities.useQuery(
    undefined,
    {
      retry: false,
      refetchInterval: (query) => {
        const attempts =
          query.state.dataUpdateCount + query.state.fetchFailureCount;
        return getSearchCapabilityPollInterval(
          query.state.data?.vinPatternSearchReady === true,
          attempts,
        );
      },
    },
  );
  const vinPatternIndexReady =
    searchCapabilities?.vinPatternSearchReady ?? false;
  const routing = useMemo(
    () =>
      createSearchRouting(
        ALGOLIA_INDEX_NAME,
        vinPatternIndexReady,
        canUseAdvancedFilters,
      ),
    [vinPatternIndexReady, canUseAdvancedFilters],
  );

  return (
    <InstantSearchNext
      key={`${vinPatternIndexReady ? "vin-ready" : "vin-disabled"}-${canUseAdvancedFilters ? "filters-enabled" : "filters-disabled"}`}
      searchClient={searchClient}
      indexName={ALGOLIA_INDEX_NAME}
      routing={routing}
      future={INSTANT_SEARCH_FUTURE}
    >
      <ErrorBoundary>
        <AlgoliaSearchInner
          viewer={viewer}
          planAccess={planAccess}
          userLocation={userLocation}
          vinPatternIndexReady={vinPatternIndexReady}
        />
      </ErrorBoundary>
    </InstantSearchNext>
  );
}
