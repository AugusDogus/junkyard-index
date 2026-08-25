import type { BillingAccountState } from "~/lib/billing-account";
import { PLANS, type BillingInterval, type PlanTier } from "~/lib/plans";
import {
  resolveSubscriptionAction,
  type SubscriptionUpgradeAction,
} from "~/lib/subscription-action";

type ActionablePricingUpgrade = Extract<
  SubscriptionUpgradeAction,
  { kind: "checkout" | "portal" }
>;

export type PricingViewerState =
  | { kind: "guest" }
  | { kind: "registered" };

export type PricingPlanCta =
  | { kind: "disabled"; label: string }
  | { kind: "signup"; href: string; label: string }
  | ActionablePricingUpgrade;

export function resolvePricingViewerState(input: {
  initialIsRegistered: boolean;
  isPending: boolean;
  isRegistered: boolean;
}): PricingViewerState {
  const isRegistered = input.isPending
    ? input.initialIsRegistered
    : input.isRegistered;
  return isRegistered ? { kind: "registered" } : { kind: "guest" };
}

function registeredFreeLabel(account: BillingAccountState): string {
  return account.kind === "active"
    ? `Included with ${PLANS[account.tier].name}`
    : account.kind === "none"
      ? "Current plan"
      : "Free account active";
}

function resolveRegisteredPaidCta(
  account: BillingAccountState,
  tier: Exclude<PlanTier, "free">,
  interval: BillingInterval,
): PricingPlanCta {
  const action = resolveSubscriptionAction(account, {
    kind: "upgrade",
    selection: { tier, interval },
  });
  switch (action.kind) {
    case "loading":
      return { kind: "disabled", label: "Checking subscription..." };
    case "unavailable":
      return { kind: "disabled", label: "Subscription unavailable" };
    case "checkout":
    case "portal":
      return action;
  }
}

export function resolvePricingPlanCta(input: {
  viewer: PricingViewerState;
  tier: PlanTier;
  interval: BillingInterval;
  account: BillingAccountState;
}): PricingPlanCta {
  switch (input.viewer.kind) {
    case "guest":
      return input.tier === "free"
        ? {
            kind: "signup",
            href: "/auth/sign-up",
            label: "Create Free Account",
          }
        : {
            kind: "signup",
            href: "/auth/sign-up?returnTo=%2Fpricing",
            label: `Get ${PLANS[input.tier].name}`,
          };
    case "registered":
      if (input.tier === "free") {
        return {
          kind: "disabled",
          label: registeredFreeLabel(input.account),
        };
      }
      return resolveRegisteredPaidCta(
        input.account,
        input.tier,
        input.interval,
      );
  }
}
