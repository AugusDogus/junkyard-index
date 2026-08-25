"use client";

import { useCallback } from "react";
import { useSubscriptionDestination } from "~/hooks/use-subscription-destination";
import { hasPlanFeature } from "~/lib/plans";

const ALERT_UPGRADE = {
  kind: "upgrade",
  selection: { tier: "full", interval: "monthly" },
} as const;

export function useAlertSubscriptionAccess(source: string) {
  const { state, open } = useSubscriptionDestination({ source });
  const canUseAlerts =
    state.kind === "active" && hasPlanFeature(state.tier, "alerts");
  const openAlertUpgrade = useCallback(() => open(ALERT_UPGRADE), [open]);

  return { canUseAlerts, openAlertUpgrade } as const;
}
