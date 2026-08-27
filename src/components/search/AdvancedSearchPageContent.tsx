"use client";

import { AdvancedSearchForm } from "~/components/search/AdvancedSearchForm";
import { SearchAccessShell } from "~/components/search/SearchAccessShell";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import { api } from "~/trpc/react";

const YEAR_LIMITS = {
  min: 1900,
  max: new Date().getUTCFullYear() + 1,
} as const;

export function AdvancedSearchPageContent({
  isLoggedIn,
}: {
  isLoggedIn: boolean;
}) {
  const [filterOptions] = api.status.searchFacetOptions.useSuspenseQuery();

  return (
    <SearchAccessShell isLoggedIn={isLoggedIn} routingMode="none">
      {({ planAccess, booleanOrSearchReady }) => (
        <AdvancedSearchForm
          filterOptions={filterOptions}
          yearLimits={YEAR_LIMITS}
          canUseAdvancedFilters={resolveClientPlanFeatureAccess({
            access: planAccess,
            feature: "advanced_filters",
          })}
          booleanOrSearchReady={booleanOrSearchReady}
        />
      )}
    </SearchAccessShell>
  );
}
