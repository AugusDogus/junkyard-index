import { describe, expect, test } from "bun:test";
import { resolveSubscriptionAction } from "./subscription-action";

describe("subscription action", () => {
  test("sends unsubscribed upgrade intents to the selected checkout", () => {
    expect(
      resolveSubscriptionAction(
        { kind: "none" },
        {
          kind: "upgrade",
          selection: { tier: "lite", interval: "annual" },
        },
      ),
    ).toEqual({
      kind: "checkout",
      selection: { tier: "lite", interval: "annual" },
    });
  });

  test("sends every existing subscription change through the portal", () => {
    expect(
      resolveSubscriptionAction(
        { kind: "active", tier: "lite" },
        {
          kind: "upgrade",
          selection: { tier: "full", interval: "monthly" },
        },
      ),
    ).toEqual({
      kind: "portal",
      account: { kind: "active", tier: "lite" },
      selection: { tier: "full", interval: "monthly" },
    });
    expect(
      resolveSubscriptionAction(
        { kind: "needs_attention" },
        { kind: "manage" },
      ),
    ).toEqual({
      kind: "portal",
      account: { kind: "needs_attention" },
    });
  });

  test("sends accounts without a subscription to plan comparison", () => {
    expect(
      resolveSubscriptionAction({ kind: "none" }, { kind: "manage" }),
    ).toEqual({ kind: "compare_plans" });
  });

  test("keeps unavailable accounts non-actionable", () => {
    expect(
      resolveSubscriptionAction(
        { kind: "unavailable" },
        {
          kind: "upgrade",
          selection: { tier: "full", interval: "monthly" },
        },
      ),
    ).toEqual({ kind: "unavailable" });
  });
});
