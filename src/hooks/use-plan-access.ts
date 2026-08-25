"use client";

import { useEffect, useRef, useState } from "react";
import { useBillingAccount } from "~/hooks/use-billing-account";
import { billingAccountTier } from "~/lib/billing-account";
import {
  CHECKOUT_TIER_CONFIRMATION_TIMEOUT_MS,
  planAccessRefetchInterval,
  type PlanAccessState,
} from "~/lib/plans";

export function usePlanAccess(
  isLoggedIn: boolean,
  options: {
    refreshUntilPaid?: boolean;
  } = {},
): PlanAccessState {
  const [confirmationDeadlineMs] = useState(
    () => Date.now() + CHECKOUT_TIER_CONFIRMATION_TIMEOUT_MS,
  );
  const [confirmationTimedOut, setConfirmationTimedOut] = useState(false);
  const confirmationSettled = useRef(false);
  const billingAccount = useBillingAccount({
    enabled: isLoggedIn,
    refetchInterval: (state) =>
      planAccessRefetchInterval({
        refreshUntilPaid: options.refreshUntilPaid === true,
        tier: billingAccountTier(state),
        nowMs: Date.now(),
        deadlineMs: confirmationDeadlineMs,
      }),
  });
  const tier = billingAccountTier(billingAccount.state);
  const hasPaidTier = tier === "lite" || tier === "full";
  if (hasPaidTier) confirmationSettled.current = true;

  useEffect(() => {
    if (
      !isLoggedIn ||
      options.refreshUntilPaid !== true ||
      confirmationSettled.current
    ) {
      return;
    }
    const timeoutId = window.setTimeout(
      () => setConfirmationTimedOut(true),
      Math.max(0, confirmationDeadlineMs - Date.now()),
    );
    return () => window.clearTimeout(timeoutId);
  }, [
    confirmationDeadlineMs,
    hasPaidTier,
    isLoggedIn,
    options.refreshUntilPaid,
  ]);

  if (!isLoggedIn) return { kind: "resolved", tier: "free" };
  if (
    options.refreshUntilPaid &&
    confirmationTimedOut &&
    !confirmationSettled.current &&
    !hasPaidTier
  ) {
    return { kind: "unavailable", reason: "confirmation_timeout" };
  }
  if (billingAccount.state.kind === "unavailable") {
    return { kind: "unavailable", reason: "lookup_failed" };
  }
  if (tier) return { kind: "resolved", tier };
  return { kind: "loading" };
}
