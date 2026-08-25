"use client";

import { useCallback } from "react";
import { useSubscriptionDestination } from "~/hooks/use-subscription-destination";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";
import { resolvePlanAccess } from "~/lib/plan-access";

const ALERT_UPGRADE = {
  kind: "upgrade",
  selection: { tier: "full", interval: "monthly" },
} as const;

export function useAlertSubscriptionAccess(source: string) {
  const { state, open } = useSubscriptionDestination({ source });
  const canUseAlerts = resolveClientPlanFeatureAccess({
    access: resolvePlanAccess({
      isLoggedIn: true,
      billingAccount: state,
      confirmation: { kind: "inactive" },
    }),
    feature: "alerts",
  });
  const openAlertUpgrade = useCallback(() => open(ALERT_UPGRADE), [open]);

  return { canUseAlerts, openAlertUpgrade } as const;
}
