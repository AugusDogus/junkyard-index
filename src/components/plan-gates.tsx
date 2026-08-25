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
  planAccessRefetchInterval,
  type PlanAccessState,
  type PlanTier,
} from "~/lib/plans";
import type { BillingAccountOverview } from "~/server/billing";
import { api } from "~/trpc/react";
import type { SearchQuotaGateState } from "~/hooks/use-daily-search-quota";

export { useSearchQuotaGate } from "~/hooks/use-daily-search-quota";

function overviewTier(
  overview: BillingAccountOverview | undefined,
): PlanTier | null {
  if (!overview || overview.kind === "unrecognized") return null;
  return overview.kind === "active" ? overview.tier : "free";
}

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
  const query = api.subscription.getAccountOverview.useQuery(undefined, {
    enabled: isLoggedIn,
    refetchInterval: (result) => {
      return planAccessRefetchInterval({
        refreshUntilPaid: options.refreshUntilPaid === true,
        tier: overviewTier(result.state.data),
        nowMs: Date.now(),
        deadlineMs: confirmationDeadlineMs,
      });
    },
    retry: false,
  });
  if (!isLoggedIn) return { kind: "resolved", tier: "free" };
  if (
    options.refreshUntilPaid &&
    checkoutTierConfirmationStatus({
      tier: overviewTier(query.data),
      nowMs: Date.now(),
      deadlineMs: confirmationDeadlineMs,
    }) === "timed_out"
  ) {
    return { kind: "unavailable", reason: "confirmation_timeout" };
  }
  if (query.isError) {
    return { kind: "unavailable", reason: "lookup_failed" };
  }
  if (query.data?.kind === "unrecognized") {
    return { kind: "unavailable", reason: "lookup_failed" };
  }
  const tier = overviewTier(query.data);
  if (tier) return { kind: "resolved", tier };
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

function QuotaVerificationPendingOverlay() {
  return (
    <div className="bg-card mx-auto w-full max-w-2xl rounded-lg border p-6 text-left shadow-lg">
      <p className="text-sm font-medium">Verifying search limit</p>
      <p className="text-muted-foreground mt-2 text-sm text-pretty">
        Results will appear as soon as your daily search allowance is confirmed.
      </p>
    </div>
  );
}

export function SearchQuotaOverlay({
  gate,
  query,
  isGuest,
}: {
  gate: SearchQuotaGateState;
  query: string;
  isGuest: boolean;
}) {
  switch (gate.kind) {
    case "open":
      return null;
    case "verifying":
      return <QuotaVerificationPendingOverlay />;
    case "limit_exceeded":
      return <FreeQuotaOverlay query={query} isGuest={isGuest} />;
    case "verification_unavailable":
      return <QuotaVerificationOverlay />;
  }
}
