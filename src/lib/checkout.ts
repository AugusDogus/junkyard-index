"use client";

import posthog from "posthog-js";
import { toast } from "sonner";
import { authClient } from "~/lib/auth-client";
import { AnalyticsEvents } from "~/lib/analytics-events";
import {
  type BillingInterval,
  type PlanTier,
  checkoutSlugFor,
} from "~/lib/plans";

export interface CheckoutAttribution {
  source_page: string;
  cta_location: string;
  [key: string]: unknown;
}

/**
 * Single entry point for paid-plan checkouts: consistent analytics shape and
 * error handling for every upgrade CTA in the app.
 */
export async function startTierCheckout(
  tier: Exclude<PlanTier, "free">,
  interval: BillingInterval,
  attribution: CheckoutAttribution,
): Promise<boolean> {
  posthog.capture(AnalyticsEvents.CHECKOUT_INITIATED, {
    source: "pricing_flow",
    ...attribution,
    plan_tier: tier,
    billing_interval: interval,
  });
  try {
    await authClient.checkout({ slug: checkoutSlugFor(tier, interval) });
    return true;
  } catch (error) {
    console.error("Failed to open checkout:", error);
    toast.error("Failed to open checkout. Please try again.");
    return false;
  }
}
