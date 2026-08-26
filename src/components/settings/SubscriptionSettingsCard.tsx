"use client";

import Link from "next/link";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useSubscriptionDestination } from "~/hooks/use-subscription-destination";
import { PLANS } from "~/lib/plans";

export function SubscriptionSettingsCard() {
  const {
    state,
    open: openSubscriptionDestination,
    retry,
  } = useSubscriptionDestination({
    source: "settings_subscription_card",
  });

  return (
    <section aria-labelledby="current-plan-heading">
      <div className="max-w-2xl">
        <h2 id="current-plan-heading" className="text-xl font-semibold">
          Current plan
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Lite includes filters and saved searches from $
          {PLANS.lite.monthlyPrice}/month. Full adds email and Discord alerts
          from ${PLANS.full.monthlyPrice}/month.{" "}
          <Link
            href="/pricing"
            className="text-foreground underline underline-offset-4"
          >
            Compare plans
          </Link>
          .
        </p>
      </div>

      <div className="border-border mt-6 border-y py-5">
        {state.kind === "loading" ? (
          <Skeleton className="h-10 w-48" />
        ) : state.kind === "unavailable" ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Plan status unavailable</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Billing could not be verified. Your existing account data is
                unchanged.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void retry()}>
              Try again
            </Button>
          </div>
        ) : state.kind === "active" ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">
                {PLANS[state.tier].name} plan
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                Your subscription is active.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void openSubscriptionDestination({ kind: "manage" })
              }
            >
              Open billing portal
            </Button>
          </div>
        ) : state.kind === "needs_attention" ? (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Billing needs attention</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Open the billing portal to review your subscription.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void openSubscriptionDestination({ kind: "manage" })
              }
            >
              Open billing portal
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Free plan</p>
              <p className="text-muted-foreground mt-1 text-sm">
                No paid subscription is active.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href="/pricing">Compare plans</Link>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
