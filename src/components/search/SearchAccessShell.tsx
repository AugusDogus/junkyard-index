"use client";

import { useMemo, type ReactNode } from "react";
import { InstantSearchNext } from "react-instantsearch-nextjs";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { createSearchRouting } from "~/components/search/search-routing";
import { Skeleton } from "~/components/ui/skeleton";
import { useCheckoutPlanAccess } from "~/hooks/use-checkout-plan-access";
import { ALGOLIA_INDEX_NAME, getSearchClient } from "~/lib/algolia-search";
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
  const searchClient = getSearchClient(booleanOrSearchReady);
  const routing = useMemo(
    () =>
      createSearchRouting(
        ALGOLIA_INDEX_NAME,
        vinPatternIndexReady,
        canUseAdvancedFilters,
      ),
    [vinPatternIndexReady, canUseAdvancedFilters],
  );

  if (isPending) {
    return (
      <div className="container mx-auto space-y-6 px-4 py-8" aria-busy="true">
        <span className="sr-only">Loading search</span>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <InstantSearchNext
      key={`${vinPatternIndexReady ? "vin-ready" : "vin-disabled"}-${booleanOrSearchReady ? "boolean-ready" : "boolean-disabled"}-${canUseAdvancedFilters ? "filters-enabled" : "filters-disabled"}`}
      searchClient={searchClient}
      indexName={ALGOLIA_INDEX_NAME}
      routing={routing}
      future={INSTANT_SEARCH_FUTURE}
    >
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
