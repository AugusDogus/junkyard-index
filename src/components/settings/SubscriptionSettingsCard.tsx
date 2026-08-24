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
import { MONETIZATION_CONFIG } from "~/lib/constants";

export function SubscriptionSettingsCard() {
  const {
    hasActiveSubscription,
    hasManageableSubscription,
    isError,
    isLoading,
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
          Alerts Plan includes unlimited saved searches plus email and Discord
          alerts for ${MONETIZATION_CONFIG.ALERTS_PLAN_PRICE_MONTHLY}/mo.{" "}
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
              <span className="font-medium">Active subscription</span>
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
            <Button
              size="sm"
              onClick={() => void openSubscriptionDestination()}
            >
              Subscribe (${MONETIZATION_CONFIG.ALERTS_PLAN_PRICE_MONTHLY}/mo)
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
