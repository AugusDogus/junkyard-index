import { describe, expect, test } from "bun:test";
import {
  alertDisableOutcomeForReason,
  classifyAlertEntitlement,
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

describe("classifyAlertEntitlement", () => {
  test("zero active subscriptions is missing regardless of tier", () => {
    expect(classifyAlertEntitlement(0, "free")).toEqual({
      kind: "inactive",
      reason: "missing",
    });
    // A Lite subscription that fully canceled leaves zero active rows
    expect(classifyAlertEntitlement(0, "lite")).toEqual({
      kind: "inactive",
      reason: "missing",
    });
  });

  test("held below-Full subscription is plan_downgraded", () => {
    expect(classifyAlertEntitlement(1, "lite")).toEqual({
      kind: "inactive",
      reason: "plan_downgraded",
    });
    // Legacy grandfathered subscribers resolve as full and keep alerts
    expect(classifyAlertEntitlement(1, "full")).toEqual({ kind: "active" });
  });

  test("Full-tier subscriber keeps alerts", () => {
    expect(classifyAlertEntitlement(2, "full")).toEqual({ kind: "active" });
  });
});
