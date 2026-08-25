"use client";

import posthog from "posthog-js";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "~/components/ui/button";
import { AnalyticsEvents } from "~/lib/analytics-events";

import {
  FREE_DAILY_SEARCH_LIMIT,
  PLANS,
  type PlanAccessState,
} from "~/lib/plans";
import { api } from "~/trpc/react";

export { useDailySearchQuota } from "~/hooks/use-daily-search-quota";

/** Subscribes to the viewer's plan tier via tRPC. */
export function usePlanTier(
  isLoggedIn: boolean,
  options: {
    initialAccess?: PlanAccessState;
    refreshUntilPaid?: boolean;
  } = {},
): PlanAccessState {
  const utils = api.useUtils();
  const recoverUnavailable = options.initialAccess?.kind === "unavailable";
  const useFreshRead = options.refreshUntilPaid === true || recoverUnavailable;
  const query = api.subscription.getTier.useQuery(
    { fresh: useFreshRead },
    {
      enabled:
        isLoggedIn && (options.initialAccess === undefined || useFreshRead),
      placeholderData:
        options.initialAccess?.kind === "resolved"
          ? { tier: options.initialAccess.tier }
          : undefined,
      refetchInterval: (result) => {
        if (!useFreshRead) return false;
        const tier = result.state.data?.tier;
        if (recoverUnavailable && tier) return false;
        return tier === "lite" || tier === "full" ? false : 2_000;
      },
      retry: false,
    },
  );
  useEffect(() => {
    const tier = query.data?.tier;
    if (useFreshRead && (tier === "lite" || tier === "full")) {
      utils.subscription.getTier.setData({ fresh: false }, { tier });
    }
  }, [query.data?.tier, useFreshRead, utils]);
  if (!isLoggedIn) return { kind: "resolved", tier: "free" };
  if (query.isError) return { kind: "unavailable" };
  if (query.data) return { kind: "resolved", tier: query.data.tier };
  return options.initialAccess ?? { kind: "loading" };
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
