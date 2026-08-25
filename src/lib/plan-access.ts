import {
  billingAccountTier,
  type BillingAccountState,
} from "~/lib/billing-account";
import type { CheckoutConfirmationState } from "~/lib/checkout-confirmation";
import type { PlanTier } from "~/lib/plans";

export type PlanAccessState =
  | { kind: "loading" }
  | {
      kind: "unavailable";
      reason: "lookup_failed" | "confirmation_timeout";
    }
  | { kind: "resolved"; tier: PlanTier };

export function resolvePlanAccess(input: {
  isLoggedIn: boolean;
  billingAccount: BillingAccountState;
  confirmation: CheckoutConfirmationState;
}): PlanAccessState {
  if (!input.isLoggedIn) return { kind: "resolved", tier: "free" };

  const tier = billingAccountTier(input.billingAccount);
  if (tier === "lite" || tier === "full") {
    return { kind: "resolved", tier };
  }
  if (input.confirmation.kind === "timed_out") {
    return { kind: "unavailable", reason: "confirmation_timeout" };
  }

  switch (input.billingAccount.kind) {
    case "none":
    case "needs_attention":
      return { kind: "resolved", tier: "free" };
    case "unavailable":
      return { kind: "unavailable", reason: "lookup_failed" };
    case "loading":
      return { kind: "loading" };
    case "active":
      return { kind: "resolved", tier: input.billingAccount.tier };
  }
}

export function resolvedPlanTier(access: PlanAccessState): PlanTier | null {
  return access.kind === "resolved" ? access.tier : null;
}
