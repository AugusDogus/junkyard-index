import { type BillingInterval, type PaidPlanTier } from "~/lib/plans";

export function subscriptionUrl(
  tier: PaidPlanTier,
  interval: BillingInterval,
): string {
  const params = new URLSearchParams({ tier, interval });
  return `/subscribe?${params.toString()}`;
}
