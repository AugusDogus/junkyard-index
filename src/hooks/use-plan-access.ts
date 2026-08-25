"use client";

import { useState } from "react";
import {
  useBillingAccount,
  type BillingAccountState,
} from "~/hooks/use-billing-account";
import {
  CHECKOUT_TIER_CONFIRMATION_TIMEOUT_MS,
  checkoutTierConfirmationStatus,
  planAccessRefetchInterval,
  type PlanAccessState,
  type PlanTier,
} from "~/lib/plans";

function billingStateTier(state: BillingAccountState): PlanTier | null {
  if (state.kind === "active") return state.tier;
  if (state.kind === "none" || state.kind === "needs_attention") return "free";
  return null;
}

export function usePlanAccess(
  isLoggedIn: boolean,
  options: {
    initialAccess?: PlanAccessState;
    refreshUntilPaid?: boolean;
  } = {},
): PlanAccessState {
  const [confirmationDeadlineMs] = useState(
    () => Date.now() + CHECKOUT_TIER_CONFIRMATION_TIMEOUT_MS,
  );
  const billingAccount = useBillingAccount({
    enabled: isLoggedIn,
    refetchInterval: (overview) =>
      planAccessRefetchInterval({
        refreshUntilPaid: options.refreshUntilPaid === true,
        tier:
          overview?.kind === "active"
            ? overview.tier
            : overview && overview.kind !== "unrecognized"
              ? "free"
              : null,
        nowMs: Date.now(),
        deadlineMs: confirmationDeadlineMs,
      }),
  });
  if (!isLoggedIn) return { kind: "resolved", tier: "free" };
  const tier = billingStateTier(billingAccount.state);
  if (
    options.refreshUntilPaid &&
    checkoutTierConfirmationStatus({
      tier,
      nowMs: Date.now(),
      deadlineMs: confirmationDeadlineMs,
    }) === "timed_out"
  ) {
    return { kind: "unavailable", reason: "confirmation_timeout" };
  }
  if (billingAccount.state.kind === "unavailable") {
    return { kind: "unavailable", reason: "lookup_failed" };
  }
  if (tier) return { kind: "resolved", tier };
  return options.initialAccess ?? { kind: "loading" };
}
