import type { PlanTier } from "~/lib/plans";
import type { SearchAlertCompletion } from "./search-alert-result";

export type AlertDisableReason = "missing" | "plan_downgraded";

/**
 * Classifies a Polar customer's alert entitlement. Zero active subscriptions
 * means never-subscribed or canceled ("missing") and must be checked before
 * the tier gate, or those customers would be mislabeled as downgraded.
 */
export function classifyAlertEntitlement(
  activeSubscriptionCount: number,
  tier: PlanTier,
): { kind: "active" } | { kind: "inactive"; reason: AlertDisableReason } {
  if (activeSubscriptionCount === 0) {
    return { kind: "inactive", reason: "missing" };
  }
  // Alerts require the Full tier; legacy grandfathered subscribers resolve
  // as Full via src/server/billing/user-plan.ts.
  if (tier !== "full") {
    return { kind: "inactive", reason: "plan_downgraded" };
  }
  return { kind: "active" };
}

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
