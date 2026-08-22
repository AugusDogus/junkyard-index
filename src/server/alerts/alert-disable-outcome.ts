import type { SearchAlertCompletion } from "./search-alert-result";

export type AlertDisableReason = "missing" | "plan_downgraded";

/**
 * Maps an alert-disable reason to its analytics event and result completion.
 * "missing" covers never-subscribed and canceled customers (no active
 * subscription); "plan_downgraded" means a subscription is held but below the
 * Full tier alerts require.
 */
export function alertDisableOutcomeForReason(reason: AlertDisableReason): {
  event: string;
  completion: SearchAlertCompletion;
} {
  return reason === "plan_downgraded"
    ? {
        event: "alert_plan_tier_insufficient",
        completion: "plan_tier_insufficient_disabled",
      }
    : {
        event: "alert_no_subscription_disabled",
        completion: "no_subscription_disabled",
      };
}
