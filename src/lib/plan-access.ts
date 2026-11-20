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
  // Polar can lag a finished checkout. Until the poll confirms the new tier
  // or times out, the plan is not known yet, not free.
  if (
    input.confirmation.kind === "polling" &&
    input.billingAccount.kind !== "unavailable"
  ) {
    return { kind: "loading" };
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
