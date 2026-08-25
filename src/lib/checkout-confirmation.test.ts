import { describe, expect, test } from "bun:test";
import {
  checkoutConfirmationReducer,
  checkoutConfirmationRefetchInterval,
  initialCheckoutConfirmationState,
} from "./checkout-confirmation";

describe("checkout confirmation", () => {
  test("polls until a paid tier resolves", () => {
    const polling = initialCheckoutConfirmationState({
      enabled: true,
      nowMs: 0,
    });
    expect(polling).toEqual({ kind: "polling", deadlineMs: 30_000 });
    expect(checkoutConfirmationRefetchInterval(polling)).toBe(2_000);
    expect(
      checkoutConfirmationReducer(polling, {
        kind: "tier_resolved",
        tier: "lite",
      }),
    ).toEqual({ kind: "confirmed" });
  });

  test("times out only while polling", () => {
    const polling = initialCheckoutConfirmationState({
      enabled: true,
      nowMs: 0,
    });
    expect(
      checkoutConfirmationReducer(polling, { kind: "deadline_reached" }),
    ).toEqual({ kind: "timed_out" });
    expect(
      checkoutConfirmationReducer(
        { kind: "confirmed" },
        { kind: "deadline_reached" },
      ),
    ).toEqual({ kind: "confirmed" });
  });
});
