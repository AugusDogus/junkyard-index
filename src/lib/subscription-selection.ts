import type { BillingInterval, PlanTier } from "~/lib/plans";

export interface SubscriptionSelection {
  tier: Exclude<PlanTier, "free">;
  interval: BillingInterval;
}

export function parseSubscriptionSelection(input: {
  tier: unknown;
  interval: unknown;
}): SubscriptionSelection {
  return {
    tier: input.tier === "lite" ? "lite" : "full",
    interval: input.interval === "annual" ? "annual" : "monthly",
  };
}

export function subscriptionReturnTo(selection: SubscriptionSelection): string {
  const params = new URLSearchParams([
    ["tier", selection.tier],
    ["interval", selection.interval],
  ]);
  return `/subscribe?${params.toString()}`;
}
