"use client";

import posthog from "posthog-js";
import Link from "next/link";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { AnalyticsEvents } from "~/lib/analytics-events";

import {
  FREE_DAILY_SEARCH_LIMIT,
  PLANS,
  CHECKOUT_TIER_CONFIRMATION_TIMEOUT_MS,
  checkoutTierConfirmationStatus,
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
  const [confirmationDeadlineMs] = useState(
    () => Date.now() + CHECKOUT_TIER_CONFIRMATION_TIMEOUT_MS,
  );
  const shouldQuery =
    options.initialAccess === undefined ||
    options.initialAccess.kind === "unavailable" ||
    options.refreshUntilPaid === true;
  const query = api.subscription.getTier.useQuery(undefined, {
    enabled: isLoggedIn && shouldQuery,
    placeholderData:
      options.initialAccess?.kind === "resolved"
        ? { tier: options.initialAccess.tier }
        : undefined,
    refetchInterval: (result) => {
      if (!options.refreshUntilPaid) return false;
      return checkoutTierConfirmationStatus({
        tier: result.state.data?.tier ?? null,
        nowMs: Date.now(),
        deadlineMs: confirmationDeadlineMs,
      }) === "poll"
        ? 2_000
        : false;
    },
    retry: false,
  });
  if (!isLoggedIn) return { kind: "resolved", tier: "free" };
  if (
    options.refreshUntilPaid &&
    checkoutTierConfirmationStatus({
      tier: query.data?.tier ?? null,
      nowMs: Date.now(),
      deadlineMs: confirmationDeadlineMs,
    }) === "timed_out"
  ) {
    return { kind: "unavailable", reason: "confirmation_timeout" };
  }
  if (query.isError) {
    return { kind: "unavailable", reason: "lookup_failed" };
  }
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

export function QuotaVerificationOverlay() {
  return (
    <div className="bg-card mx-auto w-full max-w-2xl rounded-lg border p-6 text-left shadow-lg">
      <p className="text-sm font-medium">Search temporarily unavailable</p>
      <h3 className="mt-2 text-xl font-semibold tracking-tight text-balance">
        We could not verify your daily search limit.
      </h3>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm text-pretty">
        Results are hidden until the limit can be verified. Refresh the page to
        try again. Your account and saved searches are unchanged.
      </p>
    </div>
  );
}
