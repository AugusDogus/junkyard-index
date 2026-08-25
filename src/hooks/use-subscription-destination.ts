"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { authClient } from "~/lib/auth-client";
import { api } from "~/trpc/react";
import posthog from "posthog-js";

export function useSubscriptionDestination(input: {
  source: string;
  enabled?: boolean;
}) {
  const router = useRouter();
  const customerState = api.subscription.getCustomerState.useQuery(undefined, {
    enabled: input.enabled,
  });
  const state = customerState.data?.state;
  const planTier = customerState.data?.tier ?? null;
  const hasActiveSubscription = state === "active";
  const hasManageableSubscription =
    state === "active" || state === "needs_attention";

  const open = useCallback(async () => {
    if (!state) {
      toast.error(
        "We could not verify your subscription status. Please try again.",
      );
      return false;
    }
    if (!hasManageableSubscription) {
      posthog.capture(AnalyticsEvents.CHECKOUT_INITIATED, {
        source: input.source,
      });
      router.push("/subscribe");
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
  }, [hasManageableSubscription, input.source, router, state]);

  return {
    hasActiveSubscription,
    hasManageableSubscription,
    planTier,
    isError: customerState.isError,
    isLoading: customerState.isLoading,
    open,
    retry: customerState.refetch,
  };
}
