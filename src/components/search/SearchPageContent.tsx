"use client";

import { ArrivalWindow } from "~/lib/arrival-window";
import { SearchArea } from "~/lib/search-area";
import { combineSearchFilters } from "~/lib/compile-search-expression";
import { SearchYardSelection } from "~/lib/search-yard-selection";
import { SearchRadius } from "~/lib/search-radius";
import { SearchUrl } from "~/lib/search-url";
import { readFullServiceCount } from "~/lib/full-service-search";
import { ActiveFilterChips } from "./ActiveFilterChips";
import {
  ActiveSearchFilter,
  type DistanceOrigin,
} from "./active-search-filters";
import {
  AdvancedSearchButton,
  AdvancedSearchGroup,
  FilterRow,
  SearchScopeFilters,
} from "./SearchScopeFilters";

import { sanitizeYardTypes } from "./search-routing";
import type { YardType } from "~/lib/yard-service";
import { Filter, LocateFixed, MapPin } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Analytics } from "~/lib/analytics";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { toast } from "sonner";
import {
  useConfigure,
  useInfiniteHits,
  useInstantSearch,
  useInstantSearchContext,
  useRange,
  useRefinementList,
  useSearchBox,
  useSortBy,
  useStats,
} from "react-instantsearch";
import { parseAsString, useQueryState, useQueryStates } from "nuqs";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import {
  AdvancedSearchDialog,
  type AdvancedSearchSubmission,
} from "~/components/search/AdvancedSearchDialog";
import { DesktopFiltersBar } from "~/components/search/DesktopFiltersBar";
import { InventoryFilterFeedback } from "~/components/search/InventoryFilterFeedback";
import { useInventoryFilterOptions } from "~/hooks/use-inventory-filter-options";
import { InventoryFilterOptions } from "~/lib/inventory-filter-options";
import { buildSearchUrl } from "~/lib/search-utils";
import { MobileFiltersDrawer } from "~/components/search/MobileFiltersDrawer";
import {
  clearPendingSaveSearch,
  SaveSearchDialog,
} from "~/components/search/SaveSearchDialog";
import { SavedSearchesDropdown } from "~/components/search/SavedSearchesDropdown";
import {
  InventoryCheckProvider,
  type InventoryCheck,
} from "~/components/InventoryCheckContext";
import { SearchAccessShell } from "~/components/search/SearchAccessShell";
import type { SearchKeyGrant } from "~/lib/search-key-grant";
import type { SearchServerRender } from "~/lib/search-server-render";
import { SEARCH_FILTER_FACETS } from "~/components/search/search-filter-options";
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
import { SearchSortControl } from "./SearchSortControl";
import {
  getSearchableVinPattern,
  getSearchSortIndex,
  getSearchSortKey,
  sanitizeSearchSources,
  SEARCH_SORT_OPTIONS,
  SearchOwnedUrlParams,
} from "~/components/search/search-routing";
import { AnalyticsEvents, buildSearchContext } from "~/lib/analytics-events";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import type { PlanAccessState } from "~/lib/plan-access";
import { PLANS, type PlanTier } from "~/lib/plans";
import { SEARCHABLE_VEHICLE_YEAR_RANGE } from "~/lib/saved-search-filters";
import { SearchYearQuery } from "~/lib/search-year-query";
import {
  hasFiniteCoordinates,
  LOCATION_PREFERENCE_STORAGE_KEY,
  normalizeZipCode,
  parseStoredLocationPreference,
  type StoredLocationPreference,
} from "~/lib/location-preferences";
import {
  SEARCH_CARD_ATTRIBUTES,
  algoliaHitToSearchVehicle,
  type AlgoliaVehicleHit,
} from "~/lib/search-vehicles";
import { primeSearchCounts } from "~/lib/algolia-search";
import { useHiddenSources } from "~/components/HiddenSourcesContext";
import { SearchFailure } from "~/lib/search-failure";
import { SearchHitsCache } from "~/lib/search-hits-cache";
import { browserSearchKey } from "~/lib/browser-search-key";
import { SearchResultCap } from "~/lib/search-result-cap";
import { cn } from "~/lib/utils";
import type { DataSource, SearchResult as SearchResultType } from "~/lib/types";
import { VinPattern } from "~/lib/vin-pattern";
import { api } from "~/trpc/react";

// The URL keys this page writes through nuqs. Choosing an arrival window adds
// a history entry; radius and origin changes replace the current one.
const AREA_PARSERS = {
  legacyArrivalWindow: SearchUrl.parsers.legacyArrivalWindow.withOptions({
    history: "push",
  }),
  arrivalWindow: SearchUrl.parsers.arrivalWindow.withOptions({
    history: "push",
  }),
  radius: SearchUrl.parsers.radius,
  lat: SearchUrl.parsers.lat,
  lng: SearchUrl.parsers.lng,
};

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
  arrivalReferenceTime: number;
  knownYardNames?: readonly string[];
  isLoggedIn: boolean;
  /** The key this visitor's browser searches with, minted for their plan. */
  searchKey: SearchKeyGrant;
  serverSearch: SearchServerRender;
  /** Stale sources' and yards' check dates, for the hits' labels. */
  inventoryCheck: InventoryCheck;
  initialIsMobile?: boolean;
  userLocation?: { lat: number; lng: number };
}

interface AlgoliaSearchInnerProps {
  arrivalReferenceTime: number;
  isLoggedIn: boolean;
  initialIsMobile?: boolean;
  planAccess: PlanAccessState;
  /** The tier the server minted the page's search key for. */
  serverSearchKeyTier: PlanTier;
  userLocation?: { lat: number; lng: number };
  vinPatternIndexReady: boolean;
  booleanOrSearchReady: boolean;
  newestSortReady: boolean;
  /** Writes a URL built for the current search as the router's own write. */
  writeRoute(url: string): void;
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
            Choose a location for nearby inventory. The radius works with any
            sort, including Newest First.
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
            {isSubmitting ? "Saving..." : "Save location"}
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
  arrivalReferenceTime,
  isLoggedIn,
  planAccess,
  serverSearchKeyTier,
  userLocation: _userLocation,
  vinPatternIndexReady,
  booleanOrSearchReady,
  newestSortReady,
  writeRoute,
}: AlgoliaSearchInnerProps) {
  const instantSearch = useInstantSearchContext();
  const canUseAdvancedFilters = resolveClientPlanFeatureAccess({
    access: planAccess,
    feature: "advanced_filters",
  });
  const savedSearchesLocked = !resolveClientPlanFeatureAccess({
    access: planAccess,
    feature: "saved_searches",
  });
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const expressionMode = searchParams.get("syntax") === "expression";
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
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [advancedSearchParam, setAdvancedSearchParam] =
    useQueryState("advanced");
  useEffect(() => {
    if (advancedSearchParam !== "1") return;
    setAdvancedSearchOpen(true);
    void setAdvancedSearchParam(null);
  }, [advancedSearchParam, setAdvancedSearchParam]);
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
      vinPatternIndexReady && !expressionMode
        ? getSearchableVinPattern(searchValueParam)
        : null,
    [searchValueParam, vinPatternIndexReady, expressionMode],
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

  const { indexUiState, setIndexUiState, status, error, results } =
    useInstantSearch({
      catchError: true,
    });
  const hiddenSources = useHiddenSources();
  const refinementList = (indexUiState.refinementList ?? {}) as Record<
    string,
    string[]
  >;
  const yearRangeState = (indexUiState.range ?? {}) as Record<string, string>;
  // Register the complete routed search before suspending in useConfigure below.
  // The input shares this query widget; registering it here includes it in SSR.
  const { query } = useSearchBox({}, { skipSuspense: true });
  const [hitsCache] = useState(() => SearchHitsCache.create());
  const [cacheRestored, setCacheRestored] = useState(false);
  useEffect(() => {
    if (isLoggedIn) {
      try {
        hitsCache.restore(window.sessionStorage);
      } catch {
        /* Tab storage can be disabled. */
      }
    }
    setCacheRestored(true);
  }, [hitsCache, isLoggedIn]);
  useEffect(() => {
    primeSearchCounts(hiddenSources, results._rawResults[0]?.userData);
  }, [hiddenSources, results]);
  const { hits, showMore, isLastPage } = useInfiniteHits<AlgoliaVehicleHit>(
    { cache: hitsCache },
    { skipSuspense: true },
  );
  const { nbHits, processingTimeMS } = useStats({}, { skipSuspense: true });

  // Refinements only. Filter options come from Turso, not from facet values.
  const { refine: refineMake } = useRefinementList(SEARCH_FILTER_FACETS.makes, {
    skipSuspense: true,
  });
  const { refine: refineColor } = useRefinementList(
    SEARCH_FILTER_FACETS.colors,
    { skipSuspense: true },
  );
  const { refine: refineState } = useRefinementList(
    SEARCH_FILTER_FACETS.states,
    { skipSuspense: true },
  );
  const { refine: refineLocation } = useRefinementList(
    SEARCH_FILTER_FACETS.salvageYards,
    { skipSuspense: true },
  );
  const { refine: refineSource } = useRefinementList(
    {
      ...SEARCH_FILTER_FACETS.sources,
    },
    { skipSuspense: true },
  );

  useRefinementList(
    { attribute: "yardTypes", operator: "or" },
    { skipSuspense: true },
  );

  // Year range
  const { start: yearStart, refine: refineYear } = useRange(
    {
      attribute: "year",
      min: SEARCHABLE_VEHICLE_YEAR_RANGE.min,
      max: SEARCHABLE_VEHICLE_YEAR_RANGE.max,
    },
    { skipSuspense: true },
  );

  // Date/year use virtual replicas. Distance uses a UI alias for the primary;
  // the search client maps it without conflating distance and newest state.
  const sortOptions = useMemo(
    () =>
      SEARCH_SORT_OPTIONS.filter(
        (option) => newestSortReady || option.key !== "newest",
      ),
    [newestSortReady],
  );
  const sortItems = useMemo(
    () =>
      sortOptions.map(({ indexName, label }) => ({ value: indexName, label })),
    [sortOptions],
  );
  const { currentRefinement: currentSortIndex, refine: refineSortBy } =
    useSortBy({ items: sortItems }, { skipSuspense: true });

  const searchedSort = useMemo(
    () => getSearchSortKey(currentSortIndex),
    [currentSortIndex],
  );
  // A sort switch that changes the location parameters waits for Configure
  // to search with both (see handleSortChange). Until those results arrive,
  // the page already uses the new sort, so Configure gets its parameters.
  // It ends when those results arrive, or when something else (such as
  // Back) moved the index on before they did.
  const [switchingSort, setSwitchingSort] = useState<string | null>(null);
  if (
    switchingSort !== null &&
    (switchingSort === searchedSort ||
      instantSearch.mainIndex.getHelper()?.state.index !==
        getSearchSortIndex(switchingSort))
  )
    setSwitchingSort(null);
  const sortBy = switchingSort ?? searchedSort;

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
  const [area, setArea] = useQueryStates(AREA_PARSERS, {
    urlKeys: SearchUrl.urlKeys,
  });
  const radiusMiles = area.radius;
  const arrivalWindow = ArrivalWindow.parse(
    area.arrivalWindow[0] ?? area.legacyArrivalWindow[0],
  );
  const routedArea = SearchArea.fromUrl(
    new URLSearchParams(searchParams.toString()),
  );
  // The server passes one clock value through hydration and capability remounts.
  // Advancing it mid-visit would spend another request and discard cached pages.
  const arrivalFilter = ArrivalWindow.filter(
    arrivalWindow,
    arrivalReferenceTime,
  );
  const isNearbySearch = isDistanceSort || radiusMiles !== null;
  const shouldUseBrowserFallback =
    isNearbySearch &&
    !routedArea &&
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
    if (routedArea) return { lat: routedArea.lat, lng: routedArea.lng };
    if (
      effectiveLocationPreference?.mode === "zip" &&
      hasFiniteCoordinates(effectiveLocationPreference)
    ) {
      return {
        lat: effectiveLocationPreference.lat,
        lng: effectiveLocationPreference.lng,
      };
    }

    if (hasValidCoordinates(browserLocation)) {
      return browserLocation;
    }

    return undefined;
  }, [
    browserLocation,
    effectiveLocationPreference,
    routedArea?.lat,
    routedArea?.lng,
  ]);

  // The location parameters Configure searches with, for a nearby search
  // (distance sort or radius) or not. aroundRadius filters virtual replicas
  // without another index; Newest keeps its ranking while geo restricts the
  // candidates. Algolia ignores a radius without an origin, so it is left
  // out until one exists, and a radius change then costs no search.
  const nearbyParams = useCallback(
    (nearby: boolean) => {
      const aroundLatLng =
        nearby && resolvedUserLocation
          ? `${resolvedUserLocation.lat}, ${resolvedUserLocation.lng}`
          : undefined;
      const aroundLatLngViaIP =
        nearby &&
        effectiveLocationPreference?.mode === "auto" &&
        !resolvedUserLocation;
      const hasOrigin = aroundLatLng !== undefined || aroundLatLngViaIP;
      return {
        aroundLatLng,
        aroundLatLngViaIP,
        getRankingInfo: hasOrigin,
        aroundRadius: hasOrigin ? SearchRadius.meters(radiusMiles) : undefined,
      };
    },
    [effectiveLocationPreference?.mode, radiusMiles, resolvedUserLocation],
  );
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

  const inventoryFilterOptions = useInventoryFilterOptions(
    canUseAdvancedFilters,
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
  const selectedYardTypes = useMemo(
    () => sanitizeYardTypes(refinementList.yardTypes),
    [refinementList],
  );
  const selectedSources = useMemo(
    () => sanitizeSearchSources(refinementList.source ?? []),
    [refinementList],
  );
  // Selected values stay listed so they can be cleared, even if they left
  // inventory or the options have not loaded yet.
  const filterOptions = useMemo(
    () =>
      InventoryFilterOptions.withSelected(inventoryFilterOptions.data, {
        makes: selectedMakes,
        colors: selectedColors,
        states: selectedStates,
        salvageYards: selectedLocations,
      }),
    [
      inventoryFilterOptions.data,
      selectedMakes,
      selectedColors,
      selectedStates,
      selectedLocations,
    ],
  );

  const parsedRouteYears = (yearRangeState.year ?? "")
    .split(":")
    .map((value) => {
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : null;
    });
  const rawRouteMinYear = parsedRouteYears[0] ?? null;
  const rawRouteMaxYear = parsedRouteYears[1] ?? null;

  const yearMin = SEARCHABLE_VEHICLE_YEAR_RANGE.min;
  const yearMax = SEARCHABLE_VEHICLE_YEAR_RANGE.max;
  let routeMinYear = clampRouteYear(rawRouteMinYear, yearMin, yearMax);
  let routeMaxYear = clampRouteYear(rawRouteMaxYear, yearMin, yearMax);
  if (
    routeMinYear !== null &&
    routeMaxYear !== null &&
    routeMinYear > routeMaxYear
  ) {
    [routeMinYear, routeMaxYear] = [routeMaxYear, routeMinYear];
  }
  const filterYearRange: [number, number] = [
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
  // Typed years ("08 mustang") filter results too, so the Year filter shows them.
  const typedYears = expressionMode ? null : SearchYearQuery.parse(query);
  const yearRange = typedYears
    ? SearchYearQuery.narrow(filterYearRange, typedYears)
    : filterYearRange;

  // Expression yard terms own the yard scope, so no facet is the default there.
  const expressionOwnsYardTypes =
    expressionMode && SearchYardSelection.expressionTypes(query).length > 0;
  const defaultYardTypes = useMemo<YardType[]>(
    () => (expressionOwnsYardTypes ? [] : ["self_service"]),
    [expressionOwnsYardTypes],
  );
  // A routed area at the visitor's own ZIP (the homepage New near me link) is
  // that ZIP, not a saved search's location.
  const preferenceZipCode = effectiveLocationPreference?.zipCode ?? null;
  const routedAreaIsPreference =
    routedArea !== undefined &&
    effectiveLocationPreference?.lat === routedArea.lat &&
    effectiveLocationPreference.lng === routedArea.lng;
  const distanceOrigin: DistanceOrigin =
    routedArea && !routedAreaIsPreference
      ? { kind: "savedSearch" }
      : preferenceZipCode
        ? { kind: "zip", zipCode: preferenceZipCode }
        : { kind: "approximate" };
  // Non-default choices only: the Filters count and the chips agree.
  const activeFilters = ActiveSearchFilter.list({
    arrivalWindow,
    radiusMiles,
    origin: distanceOrigin,
    yardTypes: selectedYardTypes,
    defaultYardTypes,
    yearRange,
    yearLimits: { min: yearMin, max: yearMax },
    makes: selectedMakes,
    colors: selectedColors,
    states: selectedStates,
    salvageYards: selectedLocations,
    sources: selectedSources,
  });
  const activeFilterCount = activeFilters.length;

  const currentSaveSearchFilters = useMemo(
    () => ({
      arrivalWindow,
      near: (() => {
        const parsed = SearchArea.schema.safeParse({
          ...resolvedUserLocation,
          radiusMiles,
        });
        return parsed.success ? parsed.data : undefined;
      })(),
      expression: expressionMode ? query : undefined,
      vinPattern: effectiveVinPatternFilter ? vinPattern : undefined,
      makes: selectedMakes,
      colors: selectedColors,
      states: selectedStates,
      salvageYards: selectedLocations,
      sources: selectedSources,
      yardTypes: selectedYardTypes,
      minYear: filterYearRange[0],
      maxYear: filterYearRange[1],
      sortBy,
    }),
    [
      arrivalWindow,
      resolvedUserLocation,
      radiusMiles,
      expressionMode,
      query,
      selectedMakes,
      selectedColors,
      selectedStates,
      selectedLocations,
      selectedSources,
      selectedYardTypes,
      filterYearRange,
      sortBy,
      vinPattern,
      effectiveVinPatternFilter,
    ],
  );

  // VIN searches can run alone from the primary search bar. Any yard facet,
  // including the self-service default, shows results, and so does any
  // active filter chip, All yards included: the results match the chips.
  const hasActiveSearch =
    query.length > 0 ||
    Boolean(effectiveVinPatternFilter) ||
    selectedYardTypes.length > 0 ||
    activeFilters.length > 0;
  const analyticsSearchValue = effectiveVinPatternFilter ? vinPattern : query;

  // Loading = Algolia is actively fetching (not stale "0 results")
  const isSearching =
    hasActiveSearch && (status === "loading" || status === "stalled");

  // Gate on the resolved plan, not on login: free accounts see one page too.
  const searchKeyTier = useSyncExternalStore(
    browserSearchKey.subscribe,
    browserSearchKey.tier,
    () => serverSearchKeyTier,
  );
  const resultCap = SearchResultCap.resolve({
    isLoggedIn,
    planAccess,
    searchKeyTier,
  });
  const visibleLimit = resultCap.kind === "capped" ? resultCap.limit : null;
  const capReason = resultCap.kind === "capped" ? resultCap.reason : null;
  const isPlanLimit = SearchResultCap.isPlanLimit(resultCap);
  const isResultCapped = visibleLimit !== null && nbHits > visibleLimit;

  const visibleVehicles = useMemo(
    () => (visibleLimit === null ? vehicles : vehicles.slice(0, visibleLimit)),
    [vehicles, visibleLimit],
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
      hasMore: isResultCapped ? false : !isLastPage,
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
    isResultCapped,
  ]);

  const resultCapPrompt = useMemo(() => {
    if (
      !isResultCapped ||
      !searchResult ||
      visibleLimit === null ||
      capReason === "plan_pending"
    ) {
      return null;
    }

    if (capReason === "plan_unconfirmed") {
      return (
        <div className="bg-card mx-auto w-full max-w-2xl rounded-lg border p-6 text-left shadow-lg">
          <h3 className="text-xl font-medium tracking-tight text-balance">
            Your plan could not be confirmed.
          </h3>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm text-pretty">
            Showing the first {visibleLimit} results until it is. Refresh this
            page to retry and see every result on your plan.
          </p>
        </div>
      );
    }

    const ctaProperties = {
      source_page: "search",
      cta_location: "result_cap",
      query: analyticsSearchValue,
      result_count: searchResult.totalCount,
      visible_result_count: visibleLimit,
    };
    return (
      <div className="bg-card mx-auto w-full max-w-2xl rounded-lg border p-6 text-left shadow-lg">
        <p className="text-sm font-medium">Want the rest of the results?</p>
        <h3 className="mt-2 text-xl font-medium tracking-tight text-balance">
          Upgrade to Lite to see every result.
        </h3>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm text-pretty">
          Free search shows the first {visibleLimit} results. Lite is $
          {PLANS.lite.monthlyPrice}/mo for every result, state, yard and power
          filters and saved searches. Full is ${PLANS.full.monthlyPrice}/mo and
          adds email and Discord alerts when new matches arrive.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          {capReason === "visitor" && (
            <Button asChild>
              <Link
                href={signUpHref}
                onClick={() =>
                  Analytics.capture(
                    AnalyticsEvents.RESULT_CAP_SIGNUP_CLICKED,
                    ctaProperties,
                  )
                }
              >
                Create Free Account
              </Link>
            </Button>
          )}
          <Button
            asChild
            variant={capReason === "visitor" ? "outline" : "default"}
          >
            <Link
              href="/pricing"
              onClick={() =>
                Analytics.capture(
                  AnalyticsEvents.RESULT_CAP_PRICING_CLICKED,
                  ctaProperties,
                )
              }
            >
              See Pricing
            </Link>
          </Button>
        </div>
      </div>
    );
  }, [
    isResultCapped,
    capReason,
    visibleLimit,
    analyticsSearchValue,
    searchResult,
    signUpHref,
  ]);

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

  // Sorting searches at once, with the old sort's location parameters, and
  // Configure then searches again with the new ones. When a switch changes
  // them, set the index without searching and let Configure's update run
  // the one search with both. Returns false if there is no helper yet.
  const switchSortWithConfigure = useCallback(
    (value: string) => {
      const helper = instantSearch.mainIndex.getHelper();
      if (!helper) return false;
      helper
        .setQueryParameter("sortBy", undefined)
        .setIndex(getSearchSortIndex(value));
      setSwitchingSort(value);
      return true;
    },
    [instantSearch],
  );

  const handleDistancePreferenceConfirm = useCallback(async () => {
    try {
      await applyDistancePreference(selectedDistanceMode);
      // Write only a real change: Next writes a nuqs URL back when it
      // commits, which would undo the sort route written just below.
      if (area.lat !== null || area.lng !== null)
        await setArea({ lat: null, lng: null });
      setShowDistancePreferenceDialog(false);
      toast.success(
        isLoggedIn
          ? "Distance location saved. You can update it later from Settings."
          : "Distance location saved for this browser. Use Distance location to change it.",
        { style: { fontFamily: "var(--font-brand), monospace" } },
      );

      if (pendingDistanceSort) {
        // Without a radius, Distance is what turns the new location on, so
        // Configure searches once with both. A radius already used it.
        if (radiusMiles !== null || !switchSortWithConfigure("distance"))
          refineSortBy(getSearchSortIndex("distance"));
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
    area.lat,
    area.lng,
    setArea,
    isLoggedIn,
    pendingDistanceSort,
    radiusMiles,
    refineSortBy,
    selectedDistanceMode,
    switchSortWithConfigure,
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

      Analytics.capture(AnalyticsEvents.SORT_CHANGED, { sort_option: value });
      const current = nearbyParams(isNearbySearch);
      const next = nearbyParams(value === "distance" || radiusMiles !== null);
      const changesLocation =
        current.aroundLatLng !== next.aroundLatLng ||
        current.aroundLatLngViaIP !== next.aroundLatLngViaIP ||
        current.aroundRadius !== next.aroundRadius;
      if (changesLocation && switchSortWithConfigure(value)) return;
      refineSortBy(getSearchSortIndex(value));
    },
    [
      hasUsableLocationPreference,
      isNearbySearch,
      locationPreferenceReady,
      nearbyParams,
      radiusMiles,
      refineSortBy,
      switchSortWithConfigure,
      setManualZipCode,
      setPendingDistanceSort,
      setShowDistancePreferenceDialog,
    ],
  );

  /** Clears every filter, then applies `yardTypes` as the yard scope. */
  const clearFilters = useCallback(
    (yardTypes: readonly YardType[]) => {
      Analytics.capture(AnalyticsEvents.FILTERS_CLEARED, {
        previous_filter_count: activeFilterCount,
      });
      const helper = instantSearch.mainIndex.getHelper();
      if (!helper) return;
      SearchOwnedUrlParams.hold(new URLSearchParams(), () => {
        const route = instantSearch.createURL();
        // Clear facets without searching the old window/radius. Configure
        // performs the combined search once the URL-controlled filters clear.
        helper.clearRefinements();
        for (const type of yardTypes)
          helper.addDisjunctiveFacetRefinement("yardTypes", type);
        // Typed years filter results too, so clearing filters drops them too.
        if (typedYears?.range) helper.setQuery(typedYears.query);
        // nuqs builds its URL from the current one when it flushes, and Next
        // then writes that URL back over route writes it did not see. So
        // write a changed route first, and let nuqs replace its entry.
        const clearedRoute = instantSearch.createURL();
        const clearOwned = (history: "push" | "replace") =>
          setArea(
            {
              legacyArrivalWindow: null,
              arrivalWindow: null,
              radius: null,
              lat: null,
              lng: null,
            },
            { history },
          );
        if (clearedRoute === route) return clearOwned("push");
        writeRoute(clearedRoute);
        // nuqs takes any other pushState for a navigation and drops its queued
        // writes in a microtask that push queues. Queue these after that one.
        return Promise.resolve().then(() => clearOwned("replace"));
      });
      // Clearing a window, or a radius around an origin, changes Configure,
      // which then searches. A radius without an origin was never sent.
      const radiusApplies =
        radiusMiles !== null && nearbyParams(true).getRankingInfo;
      if (!arrivalWindow && !radiusApplies) helper.search();
    },
    [
      activeFilterCount,
      instantSearch,
      arrivalWindow,
      nearbyParams,
      radiusMiles,
      setArea,
      typedYears,
      writeRoute,
    ],
  );
  // The default yard scope is not a filter, so clearing all returns to it.
  const clearAllFilters = useCallback(
    () => clearFilters(defaultYardTypes),
    [clearFilters, defaultYardTypes],
  );

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

  const handleYardTypesChange = (types: YardType[]) =>
    setIndexUiState((previous) => ({
      ...previous,
      page: 1,
      refinementList: { ...previous.refinementList, yardTypes: types },
    }));

  const handleSourcesChange = useCallback(
    (newSources: DataSource[]) =>
      applyRefinementDiff(selectedSources, newSources, refineSource),
    [selectedSources, refineSource, applyRefinementDiff],
  );

  // Editing the Year filter takes over from typed years, so drop them from the
  // query. Otherwise they would keep narrowing what the filter now shows.
  const handleYearRangeChange = useCallback(
    (range: [number, number]) => {
      if (!typedYears?.range) {
        refineYear(range);
        return;
      }
      const { query: rest } = typedYears;
      const cleared = range[0] === yearMin && range[1] === yearMax;
      setIndexUiState((previous) => {
        const otherRanges = { ...previous.range };
        delete otherRanges.year;
        return {
          ...previous,
          query: rest,
          page: 1,
          range: cleared
            ? otherRanges
            : { ...otherRanges, year: `${range[0]}:${range[1]}` },
        };
      });
    },
    [refineYear, setIndexUiState, typedYears, yearMin, yearMax],
  );

  const handleAdvancedSearch = useCallback(
    (submission: AdvancedSearchSubmission) => {
      router.push(buildSearchUrl(submission.query, submission.filters));
    },
    [router],
  );

  const setArrivalWindow = (value: ArrivalWindow | undefined) =>
    void setArea({
      legacyArrivalWindow: null,
      arrivalWindow: value ? [value] : null,
    });

  const removeFilter = (filter: ActiveSearchFilter) => {
    switch (filter.kind) {
      case "arrival":
        return setArrivalWindow(undefined);
      case "distance":
        return void setArea({ radius: null });
      case "yardTypes":
        return handleYardTypesChange(defaultYardTypes);
      case "year":
        return handleYearRangeChange([yearMin, yearMax]);
      case "makes":
        return handleMakesChange([]);
      case "colors":
        return handleColorsChange([]);
      case "states":
        return handleStatesChange([]);
      case "salvageYards":
        return handleLocationsChange([]);
      case "sources":
        return handleSourcesChange([]);
    }
  };

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
      Analytics.capture(AnalyticsEvents.SEARCH_EMPTY, ctx);
    } else {
      Analytics.capture(AnalyticsEvents.SEARCH_COMPLETED, ctx);
    }
  }, [analyticsSearchValue, isSearching, error, nbHits, processingTimeMS]);

  useEffect(() => {
    if (
      !analyticsSearchValue ||
      !isResultCapped ||
      !isPlanLimit ||
      visibleLimit === null ||
      isSearching ||
      error
    )
      return;
    if (lastTrackedResultCapQuery.current === analyticsSearchValue) return;
    lastTrackedResultCapQuery.current = analyticsSearchValue;

    Analytics.capture(AnalyticsEvents.RESULT_CAP_REACHED, {
      source_page: "search",
      query: analyticsSearchValue,
      query_length: analyticsSearchValue.trim().length,
      result_count: nbHits,
      visible_result_count: visibleLimit,
      is_logged_in: isLoggedIn,
      cap_reason: capReason,
    });
  }, [
    analyticsSearchValue,
    isResultCapped,
    isPlanLimit,
    isSearching,
    error,
    nbHits,
    visibleLimit,
    isLoggedIn,
    capReason,
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

  const locationParams = nearbyParams(isNearbySearch);
  const useAlgoliaIpLocation = locationParams.aroundLatLngViaIP;

  const renderAdvancedSearchDialog = (
    triggerClassName?: string,
    controlledState?: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
    },
  ) => (
    <AdvancedSearchDialog
      expression={expressionMode ? query : undefined}
      query={vinPattern || query}
      makes={selectedMakes}
      colors={selectedColors}
      states={selectedStates}
      salvageYards={selectedLocations}
      sources={selectedSources}
      yardTypes={selectedYardTypes}
      yearRange={filterYearRange}
      sortBy={sortBy}
      arrivalWindow={arrivalWindow}
      near={currentSaveSearchFilters.near}
      filterOptions={inventoryFilterOptions.data}
      filterOptionsFeedback={
        <InventoryFilterFeedback
          isPending={inventoryFilterOptions.isPending}
          isError={inventoryFilterOptions.isError}
          retry={() => void inventoryFilterOptions.refetch()}
        />
      }
      canUseAdvancedFilters={canUseAdvancedFilters}
      booleanOrSearchReady={booleanOrSearchReady}
      vinPatternSearchReady={vinPatternIndexReady}
      triggerClassName={triggerClassName}
      {...(controlledState
        ? { ...controlledState, showTrigger: false }
        : undefined)}
      onSearch={handleAdvancedSearch}
    />
  );

  // Filter bars list Turso options, which load separately from search.
  const filterBarFeedback = (
    <InventoryFilterFeedback
      isPending={inventoryFilterOptions.isPending}
      isError={inventoryFilterOptions.isError}
      retry={() => void inventoryFilterOptions.refetch()}
      canTypeValues={false}
    />
  );

  const openDistancePreference = () => {
    setSelectedDistanceMode(effectiveLocationPreference?.mode ?? "zip");
    setManualZipCode(effectiveLocationPreference?.zipCode ?? "");
    setShowDistancePreferenceDialog(true);
  };

  // Free on every plan, so these lead the Filters panel and drawer.
  const scopeFilters = (
    <SearchScopeFilters
      arrivalWindow={arrivalWindow}
      onArrivalWindowChange={setArrivalWindow}
      locationLabel={
        distanceOrigin.kind === "savedSearch"
          ? "Saved location"
          : distanceOrigin.kind === "zip"
            ? `ZIP ${distanceOrigin.zipCode}`
            : effectiveLocationPreference?.mode === "auto"
              ? "Approximate location"
              : "Set location"
      }
      onChooseLocation={openDistancePreference}
      radiusMiles={radiusMiles}
      onRadiusChange={(miles) =>
        void setArea({ radius: SearchRadius.parse(miles) })
      }
      yardTypes={selectedYardTypes}
      expression={expressionMode ? query : undefined}
      onYardTypesChange={handleYardTypesChange}
      onEditExpression={() => setAdvancedSearchOpen(true)}
    />
  );

  // What the search covers with no filters: the self-service default, or
  // the yard types the expression names.
  const defaultScopeLabel = expressionOwnsYardTypes
    ? "No filters applied"
    : "Self-service yards";
  const mobileFiltersDrawer = (
    <MobileFiltersDrawer
      scope={scopeFilters}
      onAdvancedSearch={() => setAdvancedSearchOpen(true)}
      activeFilterCount={activeFilterCount}
      defaultScopeLabel={defaultScopeLabel}
      resultCount={
        searchResult && !isSearching ? searchResult.totalCount : null
      }
      clearAllFilters={clearAllFilters}
      makes={selectedMakes}
      colors={selectedColors}
      states={selectedStates}
      salvageYards={selectedLocations}
      sources={selectedSources}
      yearRange={yearRange}
      filterOptions={filterOptions}
      filterOptionsFeedback={filterBarFeedback}
      onMakesChange={handleMakesChange}
      onColorsChange={handleColorsChange}
      onStatesChange={handleStatesChange}
      onSalvageYardsChange={handleLocationsChange}
      onSourcesChange={handleSourcesChange}
      onYearRangeChange={handleYearRangeChange}
      yearRangeLimits={{ min: yearMin, max: yearMax }}
      canUseAdvancedFilters={canUseAdvancedFilters}
    />
  );

  // One row: what shapes the results on the left, saving on the right.
  const workspaceActions = (
    // Narrow phones trim button padding, so the row keeps headroom for
    // wider fallback fonts.
    <div className="flex w-full items-center gap-1.5 md:gap-2 [&_[data-slot=select-trigger]]:h-11 md:[&_[data-slot=select-trigger]]:h-9 [&_button]:h-11 [&_button]:min-w-11 max-[399px]:[&_button]:gap-1.5! max-[399px]:[&_button]:px-2! md:[&_button]:h-9">
      <div className="md:hidden">{mobileFiltersDrawer}</div>
      <Button
        type="button"
        variant="outline"
        aria-pressed={showFilters}
        onClick={() => setShowFilters((open) => !open)}
        // A quiet fill only while the panel is open.
        className={cn("hidden md:flex", showFilters && "bg-muted")}
      >
        <Filter data-icon="inline-start" />
        Filters
        {activeFilterCount > 0 && (
          <span className="tabular-nums">({activeFilterCount})</span>
        )}
      </Button>
      <SearchSortControl
        value={sortBy}
        onChange={handleSortChange}
        options={sortOptions}
      />
      <div className="ml-auto flex items-center gap-1.5 md:gap-2">
        <SaveSearchDialog
          query={expressionMode ? "" : query}
          filters={currentSaveSearchFilters}
          planAccess={planAccess}
          disabled={
            !hasActiveSearch || (radiusMiles !== null && !resolvedUserLocation)
          }
          isLoggedIn={isLoggedIn}
          autoOpen={autoOpenSaveDialog}
          onAutoOpenHandled={handleAutoOpenHandled}
          responsive
        />
        {isLoggedIn && (
          <SavedSearchesDropdown responsive locked={savedSearchesLocked} />
        )}
      </div>
    </div>
  );
  const extraFullServiceCount = readFullServiceCount(
    results._rawResults[0]?.userData,
  );
  const yardSuggestion =
    !isSearching &&
    !error &&
    selectedYardTypes.length === 1 &&
    selectedYardTypes[0] === "self_service"
      ? SearchYardSelection.suggestion(nbHits, extraFullServiceCount)
      : "none";
  const fullServiceSuggestion =
    yardSuggestion === "none"
      ? undefined
      : {
          kind: yardSuggestion,
          selfServiceCount: nbHits,
          extraCount: extraFullServiceCount,
          showThem: () =>
            handleYardTypesChange(["self_service", "full_service"]),
        };
  const searchResultsPanelModel = resolveSearchResultsPanelModel({
    lifecycle: {
      hasActiveSearch,
      isSearching,
      failure: error ? SearchFailure.classify(error) : null,
      searchResult,
    },
    header: {
      actions: null,
      visibleCount: isResultCapped ? visibleLimit : null,
    },
    loading: {
      showMore,
    },
    empty: {
      // Recovery only widens: yard scope stays when clearing the rest.
      clearFilters: activeFilters.some((filter) => filter.kind !== "yardTypes")
        ? () => clearFilters(selectedYardTypes)
        : null,
      includeAllYards:
        selectedYardTypes.length > 0 ? () => handleYardTypesChange([]) : null,
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
      isLastPage: isResultCapped || isLastPage,
      isFetchingNextPage:
        !isResultCapped && (status === "loading" || status === "stalled"),
      endOfResults: resultCapPrompt,
      staticPage: visibleLimit !== null,
      visibleCount: isResultCapped ? visibleLimit : undefined,
      sessionKey:
        visibleLimit === null && cacheRestored
          ? hitsCache.activeKey()
          : undefined,
    },
  });

  // This final search hook suspends only after query, facets, and sort are registered.
  useConfigure({
    hitsPerPage: visibleLimit ?? 24,
    attributesToRetrieve: [...SEARCH_CARD_ATTRIBUTES],
    attributesToHighlight: [],
    attributesToSnippet: [],
    ...locationParams,
    filters: combineSearchFilters(effectiveVinPatternFilter, arrivalFilter),
  });

  return (
    <main className="shell">
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
      {renderAdvancedSearchDialog(undefined, {
        open: advancedSearchOpen,
        onOpenChange: setAdvancedSearchOpen,
      })}

      {/* Tuck under the sticky header's bottom border (header heights 101px,
          109px from sm, 73px from md), so no results show between them. */}
      <div className="bg-background sticky top-[6.25rem] z-40 -mx-(--gutter) px-(--gutter) py-3 sm:top-[6.75rem] md:top-[4.5rem] [@media(max-height:500px)]:static">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3">
            <ErrorBoundary>
              <VehicleSearchInput
                vinPattern={vinPattern}
                vinPatternSearchReady={vinPatternIndexReady}
                booleanOrSearchReady={booleanOrSearchReady}
                onSearchModeChange={handleSearchModeChange}
              />
            </ErrorBoundary>
            {workspaceActions}
          </div>
        </div>
      </div>
      {showFilters && (
        // Phones edit the same filters in the drawer.
        <section
          aria-label="Filters"
          className="mb-3 hidden flex-col gap-5 rounded-md border p-4 md:flex"
        >
          {scopeFilters}
          <div className="border-t pt-5">
            <FilterRow label="More filters">
              <DesktopFiltersBar
                activeFilterCount={activeFilterCount}
                defaultScopeLabel={defaultScopeLabel}
                makes={selectedMakes}
                colors={selectedColors}
                states={selectedStates}
                salvageYards={selectedLocations}
                sources={selectedSources}
                yearRange={yearRange}
                filterOptions={filterOptions}
                filterOptionsFeedback={filterBarFeedback}
                onMakesChange={handleMakesChange}
                onColorsChange={handleColorsChange}
                onStatesChange={handleStatesChange}
                onSalvageYardsChange={handleLocationsChange}
                onSourcesChange={handleSourcesChange}
                onYearRangeChange={handleYearRangeChange}
                yearRangeLimits={{ min: yearMin, max: yearMax }}
                canUseAdvancedFilters={canUseAdvancedFilters}
              />
            </FilterRow>
          </div>
          <div className="border-t pt-5">
            <AdvancedSearchGroup locked={!canUseAdvancedFilters}>
              <AdvancedSearchButton
                locked={!canUseAdvancedFilters}
                onClick={() => setAdvancedSearchOpen(true)}
              />
            </AdvancedSearchGroup>
          </div>
        </section>
      )}
      <ActiveFilterChips
        filters={activeFilters}
        onRemove={removeFilter}
        onClearAll={clearAllFilters}
        notice={
          radiusMiles !== null &&
          !resolvedUserLocation &&
          !useAlgoliaIpLocation ? (
            <p className="text-muted-foreground text-sm text-pretty">
              Choose a location to see arrivals within this radius.{" "}
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-sm"
                onClick={openDistancePreference}
              >
                Choose location
              </Button>
            </p>
          ) : undefined
        }
      />

      <div className="w-full pt-3 pb-6">
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

          <SearchResultsPanel
            model={searchResultsPanelModel}
            fullServiceSuggestion={fullServiceSuggestion}
          />
        </div>
      </div>
    </main>
  );
}

export function SearchPageContent({
  arrivalReferenceTime,
  isLoggedIn,
  initialIsMobile = false,
  userLocation,
  knownYardNames,
  serverSearch,
  searchKey,
  inventoryCheck,
}: SearchPageContentProps) {
  return (
    <InventoryCheckProvider check={inventoryCheck}>
      <SearchAccessShell
        isLoggedIn={isLoggedIn}
        searchKey={searchKey}
        knownYardNames={knownYardNames}
        serverSearch={serverSearch}
      >
        {({
          planAccess,
          vinPatternIndexReady,
          booleanOrSearchReady,
          newestSortReady,
          writeRoute,
        }) => (
          <AlgoliaSearchInner
            arrivalReferenceTime={arrivalReferenceTime}
            isLoggedIn={isLoggedIn}
            serverSearchKeyTier={searchKey.tier}
            initialIsMobile={initialIsMobile}
            planAccess={planAccess}
            userLocation={userLocation}
            vinPatternIndexReady={vinPatternIndexReady}
            booleanOrSearchReady={booleanOrSearchReady}
            newestSortReady={newestSortReady}
            writeRoute={writeRoute}
          />
        )}
      </SearchAccessShell>
    </InventoryCheckProvider>
  );
}
