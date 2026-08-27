"use client";

import {
  ArrowUpDown,
  Calendar,
  Filter,
  LocateFixed,
  MapPin,
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
import { parseAsString, useQueryState } from "nuqs";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { DesktopFiltersBar } from "~/components/search/DesktopFiltersBar";
import { MobileFiltersDrawer } from "~/components/search/MobileFiltersDrawer";
import {
  clearPendingSaveSearch,
  SaveSearchDialog,
} from "~/components/search/SaveSearchDialog";
import { SavedSearchesDropdown } from "~/components/search/SavedSearchesDropdown";
import { SearchAccessShell } from "~/components/search/SearchAccessShell";
import { SearchStartPanel } from "~/components/search/SearchStartPanel";
import { VehicleSearchInput } from "~/components/search/VehicleSearchInput";
import {
  resolveSearchResultsPanelModel,
  SearchResultsPanel,
} from "~/components/search/SearchResultsPanel";
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
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Toggle } from "~/components/ui/toggle";
import {
  getSearchableVinPattern,
  getSearchSortIndex,
  getSearchSortKey,
  sanitizeSearchSources,
  SEARCH_SORT_ITEMS,
  SEARCH_SORT_OPTIONS,
} from "~/components/search/search-routing";
import { useIsMobile } from "~/hooks/use-media-query";
import { AnalyticsEvents, buildSearchContext } from "~/lib/analytics-events";
import { ALGOLIA_INDEX_NAME } from "~/lib/algolia-search";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import { SEARCH_CONFIG } from "~/lib/constants";
import { resolvedPlanTier, type PlanAccessState } from "~/lib/plan-access";
import { PLANS } from "~/lib/plans";
import type { QuotaViewer } from "~/lib/quota-viewer";
import {
  hasFiniteCoordinates,
  LOCATION_PREFERENCE_STORAGE_KEY,
  normalizeZipCode,
  parseStoredLocationPreference,
  type StoredLocationPreference,
} from "~/lib/location-preferences";
import {
  algoliaHitToSearchVehicle,
  type AlgoliaVehicleHit,
} from "~/lib/search-vehicles";
import { cn } from "~/lib/utils";
import type { DataSource, SearchResult as SearchResultType } from "~/lib/types";
import { VinPattern } from "~/lib/vin-pattern";
import { useSearchQuotaGate } from "~/hooks/use-daily-search-quota";
import { api } from "~/trpc/react";

const MINIMUM_SEARCHABLE_VEHICLE_YEAR = 1900;

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
  const canUseAdvancedFilters = resolveClientPlanFeatureAccess({
    access: planAccess,
    feature: "advanced_filters",
  });
  const savedSearchesLocked = !resolveClientPlanFeatureAccess({
    access: planAccess,
    feature: "saved_searches",
  });
  const maximumSearchableVehicleYear = new Date().getUTCFullYear() + 1;
  const pathname = usePathname();
  const searchParams = useSearchParams();
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

  // Desktop filter workspace state
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
  const { hits, showMore, isLastPage } = useInfiniteHits<AlgoliaVehicleHit>();
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
  const { start: yearStart, refine: refineYear } = useRange({
    attribute: "year",
    min: MINIMUM_SEARCHABLE_VEHICLE_YEAR,
    max: maximumSearchableVehicleYear,
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
        const vehicle = algoliaHitToSearchVehicle(hit, resolvedUserLocation);
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

  const yearMin = MINIMUM_SEARCHABLE_VEHICLE_YEAR;
  const yearMax = maximumSearchableVehicleYear;
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
    (selectedMakes.length > 0 ? 1 : 0) +
    (selectedColors.length > 0 ? 1 : 0) +
    (selectedStates.length > 0 ? 1 : 0) +
    (selectedLocations.length > 0 ? 1 : 0) +
    (selectedSources.length > 0 ? 1 : 0) +
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
    planTier: resolvedPlanTier(planAccess),
    analyticsSearchValue,
    hasActiveSearch,
    isSearching,
    hasError: Boolean(error),
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

  const { refine: clearRefinements } = useClearRefinements();

  const clearAllFilters = useCallback(() => {
    posthog.capture(AnalyticsEvents.FILTERS_CLEARED, {
      previous_filter_count: activeFilterCount,
    });
    clearRefinements();
  }, [activeFilterCount, clearRefinements]);

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

  const workspaceActions = isMobile ? (
    <div className="flex w-full items-center gap-2 [&_[data-slot=select-trigger]]:h-11 [&_button]:h-11 [&_button]:min-w-11">
      {mobileFiltersDrawer}
      <Select value={sortBy} onValueChange={handleSortChange}>
        <SelectTrigger className="ml-auto" aria-label="Sort vehicles">
          <SortIcon className="text-muted-foreground" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {SEARCH_SORT_OPTIONS.map(({ key, label }) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {isLoggedIn && (
        <SavedSearchesDropdown iconOnly locked={savedSearchesLocked} />
      )}
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
    </div>
  ) : (
    <div className="flex shrink-0 items-center gap-2 [&_button]:h-9">
      {isLoggedIn && <SavedSearchesDropdown locked={savedSearchesLocked} />}
      <SaveSearchDialog
        query={query}
        filters={currentSaveSearchFilters}
        planAccess={planAccess}
        disabled={!hasActiveSearch}
        isLoggedIn={isLoggedIn}
        autoOpen={autoOpenSaveDialog}
        onAutoOpenHandled={handleAutoOpenHandled}
      />
      <Select value={sortBy} onValueChange={handleSortChange}>
        <SelectTrigger className="min-w-44" aria-label="Sort vehicles">
          <SortIcon className="text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {SEARCH_SORT_OPTIONS.map(({ key, label }) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Toggle
        variant="outline"
        pressed={showFilters}
        onPressedChange={setShowFilters}
        className="shrink-0 px-3"
      >
        <Filter data-icon="inline-start" />
        Filters
        {activeFilterCount > 0 && (
          <span className="tabular-nums">({activeFilterCount})</span>
        )}
      </Toggle>
    </div>
  );
  const searchResultsPanelModel = resolveSearchResultsPanelModel({
    lifecycle: {
      hasActiveSearch,
      quotaGate,
      isSearching,
      hasError: Boolean(error),
      searchResult,
    },
    header: {
      actions: null,
      processingTimeMS,
      visibleCount: isAnonymousCapped ? anonymousVisibleLimit : null,
    },
    quota: {
      query: analyticsSearchValue,
      isGuest: !isLoggedIn,
    },
    loading: {
      showMore,
    },
    empty: {
      activeFilterCount,
      clearAllFilters,
      isLoggedIn,
      query,
      filters: currentSaveSearchFilters,
      planAccess,
      saveSearchSignUpHref,
      analyticsQuery: analyticsSearchValue,
    },
    results: {
      isLoading: isSearching && hits.length === 0,
      showMore,
      isLastPage: isAnonymousCapped || isLastPage,
      isFetchingNextPage:
        !isAnonymousCapped && (status === "loading" || status === "stalled"),
      lockedPreview: anonymousResultsOverlay
        ? {
            clearRows: anonymousClearRows,
            overlay: anonymousResultsOverlay,
          }
        : undefined,
      visibleCount: isAnonymousCapped ? anonymousVisibleLimit : undefined,
    },
  });

  return (
    <main className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
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
      <section className="py-8 sm:py-10" aria-labelledby="search-page-title">
        <h1
          id="search-page-title"
          className="max-w-2xl text-3xl font-semibold text-balance sm:text-4xl"
        >
          Find the vehicle. Pull the part.
        </h1>
        <p className="text-muted-foreground mt-3 max-w-2xl text-pretty">
          Search connected salvage yard inventory by year, make, model, or VIN.
        </p>
      </section>

      <div className="bg-background sticky top-16 z-40 -mx-4 px-4 py-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-3">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
            <ErrorBoundary>
              <VehicleSearchInput
                vinPattern={vinPattern}
                vinPatternSearchReady={vinPatternIndexReady}
                onSearchModeChange={handleSearchModeChange}
              />
            </ErrorBoundary>
            {workspaceActions}
          </div>

          {!isMobile && showFilters && (
            <DesktopFiltersBar
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
          )}
        </div>
      </div>

      <div className="w-full py-6">
        <div className="min-w-0">
          {/* Empty State */}
          {!hasActiveSearch && !isSearching && (
            <SearchStartPanel
              isLoggedIn={isLoggedIn}
              savedSearchesLocked={savedSearchesLocked}
              vinPatternSearchReady={vinPatternIndexReady}
              onSearch={(searchQuery) =>
                setIndexUiState((previous) => ({
                  ...previous,
                  query: searchQuery,
                }))
              }
            />
          )}

          <SearchResultsPanel model={searchResultsPanelModel} />
        </div>
      </div>
    </main>
  );
}

export function SearchPageContent({
  viewer,
  userLocation,
}: SearchPageContentProps) {
  return (
    <SearchAccessShell viewer={viewer}>
      {({ planAccess, vinPatternIndexReady }) => (
        <AlgoliaSearchInner
          viewer={viewer}
          planAccess={planAccess}
          userLocation={userLocation}
          vinPatternIndexReady={vinPatternIndexReady}
        />
      )}
    </SearchAccessShell>
  );
}
