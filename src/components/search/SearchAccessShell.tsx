"use client";

import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { InstantSearchNext } from "react-instantsearch-nextjs";
import { useInstantSearchContext } from "react-instantsearch";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { createSearchRouting } from "~/components/search/search-routing";
import { SearchErrorFallback } from "~/components/search/SearchErrorFallback";
import { SearchExpressionFeedback } from "~/components/search/SearchExpressionFeedback";
import { SearchPageSkeleton } from "./SearchPageSkeleton";
import { useCheckoutPlanAccess } from "~/hooks/use-checkout-plan-access";
import {
  ALGOLIA_INDEX_NAME,
  getSearchClient,
  prepareSearchExpression,
} from "~/lib/algolia-search";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import type { PlanAccessState } from "~/lib/plan-access";
import { browserSearchKey } from "~/lib/browser-search-key";
import type { SearchKeyGrant } from "~/lib/search-key-grant";
import { createSearchRouteSync } from "~/lib/search-route-sync";
import type { SearchServerRender } from "~/lib/search-server-render";
import { api } from "~/trpc/react";

const INSTANT_SEARCH_FUTURE = { preserveSharedStateOnUnmount: true } as const;

interface SearchAccessShellProps {
  knownYardNames?: readonly string[];
  isLoggedIn: boolean;
  searchKey: SearchKeyGrant;
  /** "skip" renders the skeleton on the server and searches after hydration. */
  serverSearch: SearchServerRender;
  children(input: {
    planAccess: PlanAccessState;
    vinPatternIndexReady: boolean;
    booleanOrSearchReady: boolean;
    newestSortReady: boolean;
  }): ReactNode;
}

function ConsumeSearchHydration() {
  const search = useInstantSearchContext();
  useEffect(() => {
    // InstantSearchNext 1.x keeps SSR results in this window slot after hydration.
    // Consume them only after the provider mounts, including after error recovery.
    // Later capability/plan remounts must search with their own routed state.
    const hydrated = Reflect.has(
      window,
      Symbol.for("InstantSearchInitialResults"),
    );
    Reflect.deleteProperty(window, Symbol.for("InstantSearchInitialResults"));
    // Cache the hydrated page with the mounted widgets' complete parameters.
    // This render avoids repeating the server search just to prime pagination.
    if (hydrated) search.scheduleRender();
  }, [search]);
  return null;
}

const subscribeNever = () => () => {};

export function SearchAccessShell({
  isLoggedIn,
  knownYardNames,
  serverSearch,
  searchKey,
  children,
}: SearchAccessShellProps) {
  // Prime before InstantSearch's effects send the first browser search.
  // Priming is idempotent per key, so re-renders are harmless.
  if (typeof window !== "undefined") browserSearchKey.prime(searchKey);
  // False on the server and during hydration, true afterwards and on client
  // navigations, so a skipped server search starts once the page is live.
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const planAccess = useCheckoutPlanAccess(isLoggedIn);
  // A plan change (such as a finished checkout) needs a key for the new
  // plan, which the next search fetches. Drop the old key while rendering:
  // the remounted InstantSearch searches in its effects, which run before an
  // effect here would.
  if (typeof window !== "undefined" && planAccess.kind === "resolved")
    browserSearchKey.renewFor(planAccess.tier);
  const canUseAdvancedFilters = resolveClientPlanFeatureAccess({
    access: planAccess,
    feature: "advanced_filters",
  });
  const { data: searchCapabilities, isPending } =
    api.status.searchCapabilities.useQuery(undefined, {
      retry: false,
      staleTime: Infinity,
    });
  const vinPatternIndexReady =
    searchCapabilities?.vinPatternSearchReady ?? false;
  const booleanOrSearchReady =
    searchCapabilities?.booleanOrSearchReady ?? false;
  const makeAliasesReady = searchCapabilities?.makeAliasesReady ?? false;
  const newestSortReady = searchCapabilities?.newestSortReady ?? false;
  const searchParams = useSearchParams();
  const expressionMode = searchParams.get("syntax") === "expression";
  const isSearchPending =
    isPending || (expressionMode && planAccess.kind === "loading");
  const searchClient = getSearchClient(
    booleanOrSearchReady,
    expressionMode,
    canUseAdvancedFilters,
    makeAliasesReady,
  );
  // Each keyed InstantSearch instance must own its router's lifecycle state.
  const routing = useMemo(() => {
    const config = createSearchRouting(
      ALGOLIA_INDEX_NAME,
      vinPatternIndexReady,
      canUseAdvancedFilters,
      { knownYardNames, newestSortReady },
    );
    const sync = createSearchRouteSync(config.router.push);
    const routeKey = (url: string) =>
      JSON.stringify(
        config.stateMapping.routeToState(
          config.router.parseURL({ location: new URL(url) }),
        ),
      );
    // SSR already used this route. Later capability/plan remounts must replay
    // it because preserveSharedStateOnUnmount can retain incompatible facets.
    let lastRouteKey =
      typeof window !== "undefined" &&
      Reflect.has(window, Symbol.for("InstantSearchInitialResults"))
        ? routeKey(window.location.href)
        : undefined;
    return {
      ...config,
      router: {
        ...config.router,
        push(url: string) {
          lastRouteKey = routeKey(url);
          sync.push(url);
        },
        start: sync.start,
        dispose: sync.dispose,
      },
      onUrlChange(url: string) {
        const key = routeKey(url);
        // Window and radius already update Configure. Replaying an unchanged
        // routed search here would issue a second identical results request.
        if (lastRouteKey === key) return;
        lastRouteKey = key;
        sync.onUrlChange(url);
      },
    };
  }, [
    vinPatternIndexReady,
    booleanOrSearchReady,
    canUseAdvancedFilters,
    knownYardNames,
    newestSortReady,
  ]);

  useEffect(() => {
    routing.onUrlChange(window.location.href);
  }, [routing, searchParams]);

  if (isSearchPending || (serverSearch === "skip" && !hydrated)) {
    return <SearchPageSkeleton />;
  }

  if (expressionMode) {
    const prepared = prepareSearchExpression(
      searchParams.get("q") ?? "",
      booleanOrSearchReady,
      canUseAdvancedFilters,
    );
    if (!prepared.success) {
      return (
        <SearchExpressionFeedback
          error={
            prepared.error.kind === "upgrade_required" &&
            planAccess.kind === "unavailable"
              ? {
                  kind: "unavailable",
                  message:
                    "Your plan could not be confirmed. Refresh this page to retry, or remove field conditions to search for free.",
                }
              : prepared.error
          }
          isLoggedIn={isLoggedIn}
        />
      );
    }
  }

  return (
    <InstantSearchNext
      key={`${vinPatternIndexReady ? "vin-ready" : "vin-disabled"}-${booleanOrSearchReady ? "boolean-ready" : "boolean-disabled"}-${canUseAdvancedFilters ? "filters-enabled" : "filters-disabled"}-${newestSortReady ? "newest-ready" : "newest-disabled"}-${makeAliasesReady ? "make-aliases-ready" : "make-aliases-disabled"}`}
      searchClient={searchClient}
      indexName={ALGOLIA_INDEX_NAME}
      routing={routing}
      future={INSTANT_SEARCH_FUTURE}
    >
      <ConsumeSearchHydration />
      <ErrorBoundary fallback={SearchErrorFallback}>
        {children({
          planAccess,
          vinPatternIndexReady,
          booleanOrSearchReady,
          newestSortReady,
        })}
      </ErrorBoundary>
    </InstantSearchNext>
  );
}
