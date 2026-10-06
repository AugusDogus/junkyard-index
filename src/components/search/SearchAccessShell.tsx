"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, type ReactNode } from "react";
import { InstantSearchNext } from "react-instantsearch-nextjs";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { createSearchRouting } from "~/components/search/search-routing";
import { SearchExpressionFeedback } from "~/components/search/SearchExpressionFeedback";
import { Skeleton } from "~/components/ui/skeleton";
import { useCheckoutPlanAccess } from "~/hooks/use-checkout-plan-access";
import {
  ALGOLIA_INDEX_NAME,
  getSearchClient,
  prepareSearchExpression,
} from "~/lib/algolia-search";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import type { PlanAccessState } from "~/lib/plan-access";
import { api } from "~/trpc/react";

const INSTANT_SEARCH_FUTURE = { preserveSharedStateOnUnmount: true } as const;

interface SearchAccessShellProps {
  isLoggedIn: boolean;
  children(input: {
    planAccess: PlanAccessState;
    vinPatternIndexReady: boolean;
    booleanOrSearchReady: boolean;
  }): ReactNode;
}

function ConsumeSearchHydration() {
  useEffect(() => {
    // InstantSearchNext 1.x keeps SSR results in this window slot after hydration.
    // Consume them only after the provider mounts, including after error recovery.
    // Later capability/plan remounts must search with their own routed state.
    Reflect.deleteProperty(window, Symbol.for("InstantSearchInitialResults"));
  }, []);
  return null;
}

export function SearchAccessShell({
  isLoggedIn,
  children,
}: SearchAccessShellProps) {
  const planAccess = useCheckoutPlanAccess(isLoggedIn);
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
  const searchParams = useSearchParams();
  const expressionMode = searchParams.get("syntax") === "expression";
  const isSearchPending =
    isPending || (expressionMode && planAccess.kind === "loading");
  const searchClient = getSearchClient(
    booleanOrSearchReady,
    expressionMode,
    canUseAdvancedFilters,
  );
  const routing = useMemo(
    () =>
      createSearchRouting(
        ALGOLIA_INDEX_NAME,
        vinPatternIndexReady,
        canUseAdvancedFilters,
      ),
    [vinPatternIndexReady, canUseAdvancedFilters],
  );

  if (isSearchPending) {
    return (
      <div
        className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8"
        aria-busy="true"
      >
        <span className="sr-only">Loading search</span>
        <h1 className="sr-only">Search inventory</h1>
        <div className="py-3">
          <Skeleton className="h-11 w-full rounded-md sm:h-10" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
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
      key={`${vinPatternIndexReady ? "vin-ready" : "vin-disabled"}-${booleanOrSearchReady ? "boolean-ready" : "boolean-disabled"}-${canUseAdvancedFilters ? "filters-enabled" : "filters-disabled"}`}
      searchClient={searchClient}
      indexName={ALGOLIA_INDEX_NAME}
      routing={routing}
      future={INSTANT_SEARCH_FUTURE}
    >
      <ConsumeSearchHydration />
      <ErrorBoundary>
        {children({
          planAccess,
          vinPatternIndexReady,
          booleanOrSearchReady,
        })}
      </ErrorBoundary>
    </InstantSearchNext>
  );
}
