"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { authClient } from "~/lib/auth-client";
import { useBillingAccount } from "~/hooks/use-billing-account";
import {
  resolveSubscriptionAction,
  type SubscriptionIntent,
} from "~/lib/subscription-action";
import { subscriptionReturnTo } from "~/lib/subscription-selection";
import posthog from "posthog-js";

export function useSubscriptionDestination(input: {
  source: string;
  enabled?: boolean;
}) {
  const router = useRouter();
  const { state, retry } = useBillingAccount({ enabled: input.enabled });

  const open = useCallback(
    async (intent: SubscriptionIntent) => {
      const action = resolveSubscriptionAction(state, intent);
      if (action.kind === "loading" || action.kind === "unavailable") {
        toast.error(
          "We could not verify your subscription status. Please try again.",
        );
        return false;
      }
      if (action.kind === "compare_plans") {
        router.push("/pricing");
        return true;
      }
      if (action.kind === "checkout") {
        posthog.capture(AnalyticsEvents.CHECKOUT_INITIATED, {
          source: input.source,
          plan_tier: action.selection.tier,
          billing_interval: action.selection.interval,
        });
        router.push(subscriptionReturnTo(action.selection));
        return true;
      }

      posthog.capture(AnalyticsEvents.SUBSCRIPTION_PORTAL_OPENED, {
        source: input.source,
      });
      try {
        const customer = authClient.customer;
        if (!customer) {
          toast.error("Subscription management is currently unavailable.");
          return false;
        }
        const result = await customer.portal();
        if (result.error) {
          console.error("Failed to open customer portal:", result.error);
          toast.error("Failed to open subscription portal. Please try again.");
          return false;
        }
        return true;
      } catch (error) {
        console.error("Failed to open customer portal:", error);
        toast.error("Failed to open subscription portal. Please try again.");
        return false;
      }
    },
    [input.source, router, state],
  );

  return {
    state,
    open,
    retry,
  };
}
