"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { authClient } from "~/lib/auth-client";
import { useBillingAccount } from "~/hooks/use-billing-account";
import posthog from "posthog-js";

export function useSubscriptionDestination(input: {
  source: string;
  enabled?: boolean;
}) {
  const router = useRouter();
  const { state, retry } = useBillingAccount({ enabled: input.enabled });

  const open = useCallback(async () => {
    if (state.kind === "loading" || state.kind === "unavailable") {
      toast.error(
        "We could not verify your subscription status. Please try again.",
      );
      return false;
    }
    if (state.kind === "none") {
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
  }, [input.source, router, state]);

  return {
    state,
    open,
    retry,
  };
}
