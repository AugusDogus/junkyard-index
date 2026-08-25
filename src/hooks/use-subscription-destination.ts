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
  const accountOverview = api.subscription.getAccountOverview.useQuery(
    undefined,
    { enabled: input.enabled },
  );
  const overview = accountOverview.data;
  const hasActiveSubscription = overview?.kind === "active";
  const hasManageableSubscription =
    overview?.kind === "active" || overview?.kind === "needs_attention";

  const open = useCallback(async () => {
    if (!overview || overview.kind === "unrecognized") {
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
  }, [hasManageableSubscription, input.source, overview, router]);

  return {
    hasActiveSubscription,
    hasManageableSubscription,
    planTier: overview?.kind === "active" ? overview.tier : null,
    isError: accountOverview.isError || overview?.kind === "unrecognized",
    isLoading: accountOverview.isLoading,
    open,
    retry: accountOverview.refetch,
  };
}
