import { describe, expect, test } from "bun:test";
import { resolvePlanAccess, resolvedPlanTier } from "~/lib/plan-access";

describe("resolvePlanAccess", () => {
  test("reports a timed-out checkout while the account still resolves as free", () => {
    expect(
      resolvePlanAccess({
        isLoggedIn: true,
        billingAccount: { kind: "none" },
        confirmation: { kind: "timed_out" },
      }),
    ).toEqual({ kind: "unavailable", reason: "confirmation_timeout" });
  });

  test("paid confirmation wins if the tier resolves after the deadline", () => {
    expect(
      resolvePlanAccess({
        isLoggedIn: true,
        billingAccount: { kind: "active", tier: "lite" },
        confirmation: { kind: "timed_out" },
      }),
    ).toEqual({ kind: "resolved", tier: "lite" });
  });

  test("preserves loading, lookup failure, and signed-out states", () => {
    expect(
      resolvePlanAccess({
        isLoggedIn: true,
        billingAccount: { kind: "loading" },
        confirmation: { kind: "inactive" },
      }),
    ).toEqual({ kind: "loading" });
    expect(
      resolvePlanAccess({
        isLoggedIn: true,
        billingAccount: { kind: "unavailable" },
        confirmation: { kind: "inactive" },
      }),
    ).toEqual({ kind: "unavailable", reason: "lookup_failed" });
    expect(
      resolvePlanAccess({
        isLoggedIn: false,
        billingAccount: { kind: "loading" },
        confirmation: { kind: "inactive" },
      }),
    ).toEqual({ kind: "resolved", tier: "free" });
  });

  test("only exposes a tier after access resolves", () => {
    expect(resolvedPlanTier({ kind: "loading" })).toBeNull();
    expect(
      resolvedPlanTier({ kind: "unavailable", reason: "lookup_failed" }),
    ).toBeNull();
    expect(resolvedPlanTier({ kind: "resolved", tier: "lite" })).toBe("lite");
  });
});
