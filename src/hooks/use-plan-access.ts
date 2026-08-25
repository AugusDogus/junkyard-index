"use client";

import { useEffect, useReducer } from "react";
import { useBillingAccount } from "~/hooks/use-billing-account";
import { billingAccountTier } from "~/lib/billing-account";
import {
  checkoutConfirmationReducer,
  checkoutConfirmationRefetchInterval,
  initialCheckoutConfirmationState,
} from "~/lib/checkout-confirmation";
import type { PlanAccessState } from "~/lib/plans";

export function usePlanAccess(
  isLoggedIn: boolean,
  options: {
    refreshUntilPaid?: boolean;
  } = {},
): PlanAccessState {
  const [confirmation, dispatchConfirmation] = useReducer(
    checkoutConfirmationReducer,
    options.refreshUntilPaid === true,
    (enabled) =>
      initialCheckoutConfirmationState({ enabled, nowMs: Date.now() }),
  );
  const billingAccount = useBillingAccount({
    enabled: isLoggedIn,
    refetchInterval: () => checkoutConfirmationRefetchInterval(confirmation),
  });
  const tier = billingAccountTier(billingAccount.state);

  useEffect(() => {
    dispatchConfirmation(
      options.refreshUntilPaid === true
        ? { kind: "started", nowMs: Date.now() }
        : { kind: "stopped" },
    );
  }, [options.refreshUntilPaid]);

  useEffect(() => {
    dispatchConfirmation({ kind: "tier_resolved", tier });
  }, [tier]);

  useEffect(() => {
    if (!isLoggedIn || confirmation.kind !== "polling") return;
    const timeoutId = window.setTimeout(
      () => dispatchConfirmation({ kind: "deadline_reached" }),
      Math.max(0, confirmation.deadlineMs - Date.now()),
    );
    return () => window.clearTimeout(timeoutId);
  }, [confirmation, isLoggedIn]);

  if (!isLoggedIn) return { kind: "resolved", tier: "free" };
  if (tier) return { kind: "resolved", tier };
  if (confirmation.kind === "timed_out") {
    return { kind: "unavailable", reason: "confirmation_timeout" };
  }
  if (billingAccount.state.kind === "unavailable") {
    return { kind: "unavailable", reason: "lookup_failed" };
  }
  return { kind: "loading" };
}
