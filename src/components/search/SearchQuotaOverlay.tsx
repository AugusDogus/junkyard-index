"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { Button } from "~/components/ui/button";
import type { SearchQuotaGateState } from "~/hooks/use-daily-search-quota";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { FREE_DAILY_SEARCH_LIMIT, PLANS } from "~/lib/plans";

function FreeQuotaOverlay({
  query,
  isGuest,
}: {
  query: string;
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

function QuotaVerificationUnavailableOverlay() {
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
      return <QuotaVerificationUnavailableOverlay />;
  }
}
