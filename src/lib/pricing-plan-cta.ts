import type { BillingAccountState } from "~/lib/billing-account";
import { PLANS, type BillingInterval, type PlanTier } from "~/lib/plans";
import { subscriptionReturnTo } from "~/lib/subscription-selection";
import {
  resolveSubscriptionAction,
  type SubscriptionUpgradeAction,
} from "~/lib/subscription-action";

type ActionablePricingUpgrade = Extract<
  SubscriptionUpgradeAction,
  { kind: "checkout" | "portal" }
>;

/** `pending` while the session of a visitor who may be signed in loads. */
export type PricingViewerState =
  | { kind: "guest" }
  | { kind: "registered" }
  | { kind: "pending" };

/**
 * Who a page knows the visitor is before the client session loads: a
 * `guest` where only signed-out visitors land, else `unknown`.
 */
export type PricingInitialViewer = "guest" | "unknown";

export type PricingPlanCta =
  | { kind: "disabled"; label: string }
  | { kind: "signup"; href: string; label: string }
  | ActionablePricingUpgrade;

export function resolvePricingViewerState(input: {
  initialViewer: PricingInitialViewer;
  isPending: boolean;
  isRegistered: boolean;
}): PricingViewerState {
  if (input.isPending)
    return input.initialViewer === "guest"
      ? { kind: "guest" }
      : { kind: "pending" };
  return input.isRegistered ? { kind: "registered" } : { kind: "guest" };
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
    case "pending":
      return { kind: "disabled", label: "Checking account..." };
    case "guest":
      return input.tier === "free"
        ? {
            kind: "signup",
            href: "/auth/sign-up",
            label: "Create Free Account",
          }
        : {
            kind: "signup",
            href: `/auth/sign-up?returnTo=${encodeURIComponent(subscriptionReturnTo({ tier: input.tier, interval: input.interval }))}`,
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
