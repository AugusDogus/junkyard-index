import {
  isBillingInterval,
  isPaidPlanTier,
  type BillingInterval,
  type PaidPlanTier,
} from "~/lib/plans";

export interface SubscriptionSelection {
  tier: PaidPlanTier;
  interval: BillingInterval;
}

export function parseSubscriptionSelection(input: {
  tier: unknown;
  interval: unknown;
}): SubscriptionSelection {
  return {
    tier: isPaidPlanTier(input.tier) ? input.tier : "full",
    interval: isBillingInterval(input.interval) ? input.interval : "monthly",
  };
}

export function subscriptionReturnTo(selection: SubscriptionSelection): string {
  const params = new URLSearchParams([
    ["tier", selection.tier],
    ["interval", selection.interval],
  ]);
  return `/subscribe?${params.toString()}`;
}
