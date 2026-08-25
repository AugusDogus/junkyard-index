import { describe, expect, test } from "bun:test";
import {
  parseSubscriptionSelection,
  subscriptionReturnTo,
} from "./subscription-selection";

describe("subscription selection", () => {
  test("preserves a validated direct-link selection through authentication", () => {
    const selection = parseSubscriptionSelection({
      tier: "lite",
      interval: "annual",
    });

    expect(subscriptionReturnTo(selection)).toBe(
      "/subscribe?tier=lite&interval=annual",
    );
  });

  test("normalizes invalid selections to the default checkout", () => {
    const selection = parseSubscriptionSelection({
      tier: "enterprise",
      interval: ["annual"],
    });

    expect(selection).toEqual({ tier: "full", interval: "monthly" });
  });
});
