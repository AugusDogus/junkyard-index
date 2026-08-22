import { describe, expect, test } from "bun:test";
import {
  alertDisableOutcomeForReason,
  type AlertDisableReason,
} from "./alert-disable-outcome";

describe("alertDisableOutcomeForReason", () => {
  test("missing subscription maps to the no-subscription event", () => {
    const outcome = alertDisableOutcomeForReason("missing");
    expect(outcome.event).toBe("alert_no_subscription_disabled");
    expect(outcome.completion).toBe("no_subscription_disabled");
  });

  test("below-Full subscriptions map to the plan-tier event, not expired", () => {
    const outcome = alertDisableOutcomeForReason("plan_downgraded");
    expect(outcome.event).toBe("alert_plan_tier_insufficient");
    expect(outcome.completion).toBe("plan_tier_insufficient_disabled");
  });

  test("every reason has a distinct outcome", () => {
    const reasons: AlertDisableReason[] = ["missing", "plan_downgraded"];
    const events = reasons.map((r) => alertDisableOutcomeForReason(r).event);
    expect(new Set(events).size).toBe(reasons.length);
  });
});
