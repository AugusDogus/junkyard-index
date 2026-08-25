"use client";

import { useQueryState } from "nuqs";
import posthog from "posthog-js";
import { useEffect } from "react";
import { toast } from "sonner";
import { AnalyticsEvents } from "~/lib/analytics-events";
import type { PlanAccessState } from "~/lib/plan-access";

export function useCheckoutConfirmation(planAccess: PlanAccessState): void {
  const [subscriptionParam, setSubscriptionParam] =
    useQueryState("subscription");

  useEffect(() => {
    const isCheckoutSuccess = subscriptionParam === "success";
    const confirmationTimedOut =
      planAccess.kind === "unavailable" &&
      planAccess.reason === "confirmation_timeout";
    if (isCheckoutSuccess && confirmationTimedOut) {
      toast.error(
        "Subscription confirmation is taking longer than expected. Refresh this page or check Settings before trying checkout again.",
      );
      void setSubscriptionParam(null);
      return;
    }

    const hasPaidAccess =
      planAccess.kind === "resolved" && planAccess.tier !== "free";
    if (!isCheckoutSuccess || !hasPaidAccess) return;

    posthog.capture(AnalyticsEvents.SUBSCRIPTION_ACTIVATED, {
      source: "checkout_redirect",
    });
    toast.success(
      "Subscription activated! Manage your plan anytime from Settings.",
    );
    void setSubscriptionParam(null);
  }, [subscriptionParam, setSubscriptionParam, planAccess]);
}
