"use client";

import posthog from "posthog-js";
import { AnalyticsEvents } from "~/lib/analytics-events";
import { type BillingInterval, type PaidPlanTier } from "~/lib/plans";

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
  tier: PaidPlanTier,
  interval: BillingInterval,
  attribution: CheckoutAttribution,
): Promise<boolean> {
  posthog.capture(AnalyticsEvents.CHECKOUT_INITIATED, {
    source: "pricing_flow",
    ...attribution,
    plan_tier: tier,
    billing_interval: interval,
  });
  const params = new URLSearchParams({ tier, interval });
  window.location.assign(`/subscribe?${params.toString()}`);
  return true;
}
