"use client";

import { AlertCircle, CheckCircle, CreditCard } from "lucide-react";
import Link from "next/link";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { useSubscriptionDestination } from "~/hooks/use-subscription-destination";
import { PLANS } from "~/lib/plans";

export function SubscriptionSettingsCard() {
  const {
    hasActiveSubscription,
    hasManageableSubscription,
    isError,
    isLoading,
    planTier,
    open: openSubscriptionDestination,
    retry,
  } = useSubscriptionDestination({
    source: "settings_subscription_card",
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Subscription
        </CardTitle>
        <CardDescription>
          Lite includes filters and saved searches from $
          {PLANS.lite.monthlyPrice}/mo. Full adds email and Discord alerts from
          ${PLANS.full.monthlyPrice}/mo.{" "}
          <Link href="/pricing" className="text-primary hover:underline">
            Compare plans
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-10 w-48" />
        ) : isError ? (
          <div className="flex items-center justify-between gap-4">
            <p className="text-destructive text-sm">
              Subscription status could not be verified.
            </p>
            <Button variant="outline" size="sm" onClick={() => void retry()}>
              Try Again
            </Button>
          </div>
        ) : hasActiveSubscription ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle className="h-5 w-5" />
              <span className="font-medium">
                Active {planTier ? PLANS[planTier].name : "paid"} subscription
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openSubscriptionDestination()}
            >
              Manage Subscription
            </Button>
          </div>
        ) : hasManageableSubscription ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-5 w-5" />
              <span className="font-medium">Subscription needs attention</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openSubscriptionDestination()}
            >
              Manage Subscription
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="text-muted-foreground flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              <span>No active subscription</span>
            </div>
            <Button asChild size="sm">
              <Link href="/pricing">Compare Plans</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
