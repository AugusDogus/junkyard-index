"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import { AnalyticsEvents } from "~/lib/analytics-events";

import {
  FREE_DAILY_SEARCH_LIMIT,
  PLANS,
  resolvePlanFeatureAccess,
  shouldClearAdvancedFilters,
  type PlanFeature,
  type PlanTier,
} from "~/lib/plans";
import { api } from "~/trpc/react";

interface InstantSearchUiState {
  refinementList?: Record<string, string[]>;
  range?: Record<string, string>;
}

export { useDailySearchQuota } from "~/hooks/use-daily-search-quota";

/** Subscribes to the viewer's plan tier via tRPC. */
export function usePlanTier(isLoggedIn: boolean): {
  /** Resolved plan tier; null means "not known yet", never "free". */
  planTier: PlanTier | null;
  canUseAdvancedFilters: boolean;
  canSaveSearches: boolean;
  canUseAlerts: boolean;
} {
  const { data } = api.subscription.getTier.useQuery(undefined, {
    enabled: isLoggedIn,
  });
  // Logged-out viewers are free by definition; logged-in users are unknown
  // until the query resolves.
  const planTier: PlanTier | null = isLoggedIn ? (data?.tier ?? null) : "free";

  // Mutations remain optimistic while unknown because the server enforces
  // them. Advanced filters are client-only, so they remain locked until the
  // tier is authoritative.
  const resolveGate = (feature: PlanFeature): boolean =>
    resolvePlanFeatureAccess({ tier: planTier, isLoggedIn, feature });

  return {
    planTier,
    canUseAdvancedFilters: resolveGate("advanced_filters"),
    canSaveSearches: resolveGate("saved_searches"),
    canUseAlerts: resolveGate("alerts"),
  };
}

interface AdvancedFilterGateArgs {
  planTier: PlanTier | null;
  indexUiState: InstantSearchUiState;
  setIndexUiState: (
    updater: (prev: InstantSearchUiState) => InstantSearchUiState,
  ) => void;
}

/**
 * Strips URL-carried advanced filters for free-tier users before they reach
 * Algolia. Unknown tiers remain locked because Algolia has no server gate.
 */
export function useAdvancedFilterGate(args: AdvancedFilterGateArgs): void {
  const { planTier, indexUiState, setIndexUiState } = args;

  useEffect(() => {
    if (!shouldClearAdvancedFilters(planTier)) return;
    const hasAdvancedRefinements =
      Object.keys(indexUiState.refinementList ?? {}).length > 0 ||
      Object.keys(indexUiState.range ?? {}).length > 0;
    if (!hasAdvancedRefinements) return;
    setIndexUiState((prev) => ({
      ...prev,
      refinementList: {},
      range: {},
    }));
    posthog.capture(AnalyticsEvents.FILTERS_CLEARED, {
      reason: "plan_restricted",
    });
    toast.info("Filters are available on Lite and Full plans.");
  }, [planTier, indexUiState, setIndexUiState]);
}

export function FreeQuotaOverlay({
  query,
  isGuest,
}: {
  query: string;
  /** Guests hit this block too; analytics should distinguish them. */
  isGuest: boolean;
}) {
  return (
    <div className="bg-card mx-auto w-full max-w-2xl rounded-lg border p-6 text-left shadow-lg">
      <p className="text-sm font-medium">Daily limit reached</p>
      <h3 className="mt-2 text-xl font-semibold tracking-tight text-balance">
        You&apos;ve used all {FREE_DAILY_SEARCH_LIMIT} free searches for today.
      </h3>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm text-pretty">
        Upgrade to Lite (${PLANS.lite.monthlyPrice}/mo) for unlimited searches,
        advanced filters, and saved searches. Your searches reset tomorrow.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link
            href="/pricing"
            onClick={() =>
              posthog.capture(AnalyticsEvents.PRICING_CTA_CLICKED, {
                source_page: "search",
                cta_location: "free_quota_limit",
                query,
                is_logged_in: !isGuest,
              })
            }
          >
            See Pricing
          </Link>
        </Button>
      </div>
    </div>
  );
}
