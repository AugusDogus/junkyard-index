import { describe, expect, test } from "bun:test";
import {
  FREE_DAILY_SEARCH_LIMIT,
  PLANS,
  checkoutTierConfirmationStatus,
  evaluateSavedSearchGate,
  formatMonthlyEquivalent,
  hasPlanFeature,
  planPrice,
  planAccessRefetchInterval,
  resolvePlanFeatureAccess,
  resolvedPlanTier,
  tierSatisfies,
} from "~/lib/plans";

describe("plan tiers", () => {
  test("tier ordering is total", () => {
    expect(tierSatisfies("free", "free")).toBe(true);
    expect(tierSatisfies("lite", "free")).toBe(true);
    expect(tierSatisfies("full", "lite")).toBe(true);
    expect(tierSatisfies("full", "full")).toBe(true);

    expect(tierSatisfies("free", "lite")).toBe(false);
    expect(tierSatisfies("lite", "full")).toBe(false);
    expect(tierSatisfies("free", "full")).toBe(false);
  });

  test("saved searches and advanced filters require lite", () => {
    expect(hasPlanFeature("free", "saved_searches")).toBe(false);
    expect(hasPlanFeature("lite", "saved_searches")).toBe(true);
    expect(hasPlanFeature("full", "saved_searches")).toBe(true);

    expect(hasPlanFeature("free", "advanced_filters")).toBe(false);
    expect(hasPlanFeature("lite", "advanced_filters")).toBe(true);
  });

  test("alerts require full tier", () => {
    expect(hasPlanFeature("free", "alerts")).toBe(false);
    expect(hasPlanFeature("lite", "alerts")).toBe(false);
    expect(hasPlanFeature("full", "alerts")).toBe(true);
  });

  test("unknown tiers lock client-only filters but not server-gated actions", () => {
    expect(
      resolvePlanFeatureAccess({
        access: { kind: "loading" },
        feature: "advanced_filters",
      }),
    ).toBe(false);
    expect(
      resolvePlanFeatureAccess({
        access: { kind: "loading" },
        feature: "saved_searches",
      }),
    ).toBe(true);
  });

  test("distinguishes unavailable access from resolved tiers", () => {
    expect(resolvedPlanTier({ kind: "loading" })).toBeNull();
    expect(
      resolvedPlanTier({ kind: "unavailable", reason: "lookup_failed" }),
    ).toBeNull();
    expect(resolvedPlanTier({ kind: "resolved", tier: "lite" })).toBe("lite");
    expect(
      resolvePlanFeatureAccess({
        access: { kind: "unavailable", reason: "lookup_failed" },
        feature: "advanced_filters",
      }),
    ).toBe(false);
  });

  test("bounds checkout confirmation polling until a paid tier resolves", () => {
    expect(
      checkoutTierConfirmationStatus({
        tier: null,
        nowMs: 0,
        deadlineMs: 30_000,
      }),
    ).toBe("poll");
    expect(
      checkoutTierConfirmationStatus({
        tier: "free",
        nowMs: 29_999,
        deadlineMs: 30_000,
      }),
    ).toBe("poll");
    expect(
      checkoutTierConfirmationStatus({
        tier: "lite",
        nowMs: 10_000,
        deadlineMs: 30_000,
      }),
    ).toBe("confirmed");
    expect(
      checkoutTierConfirmationStatus({
        tier: "free",
        nowMs: 30_000,
        deadlineMs: 30_000,
      }),
    ).toBe("timed_out");
    expect(
      planAccessRefetchInterval({
        refreshUntilPaid: true,
        tier: "free",
        nowMs: 29_999,
        deadlineMs: 30_000,
      }),
    ).toBe(2_000);
    expect(
      planAccessRefetchInterval({
        refreshUntilPaid: false,
        tier: "full",
        nowMs: 0,
        deadlineMs: 30_000,
      }),
    ).toBe(60_000);
  });

  test("prices match the published tiers", () => {
    expect(PLANS.lite.monthlyPrice).toBe(3);
    expect(PLANS.lite.annualPrice).toBe(30);
    expect(PLANS.full.monthlyPrice).toBe(7);
    expect(PLANS.full.annualPrice).toBe(60);

    expect(planPrice("lite", "monthly")).toBe(3);
    expect(planPrice("lite", "annual")).toBe(30);
    expect(planPrice("full", "monthly")).toBe(7);
    expect(planPrice("full", "annual")).toBe(60);
  });

  test("annual monthly-equivalent formatting", () => {
    expect(formatMonthlyEquivalent("lite")).toBe("$2.50");
    expect(formatMonthlyEquivalent("full")).toBe("$5");
  });

  test("free daily search limit", () => {
    expect(FREE_DAILY_SEARCH_LIMIT).toBeGreaterThan(0);
  });
});

describe("evaluateSavedSearchGate", () => {
  test("free users always hit the Lite gate first, even with alerts requested", () => {
    expect(evaluateSavedSearchGate("free", false)).toBe("saved_searches");
    expect(evaluateSavedSearchGate("free", true)).toBe("saved_searches");
  });

  test("lite users are only blocked from alerts", () => {
    expect(evaluateSavedSearchGate("lite", false)).toBeNull();
    expect(evaluateSavedSearchGate("lite", true)).toBe("alerts");
  });

  test("full users pass both gates", () => {
    expect(evaluateSavedSearchGate("full", false)).toBeNull();
    expect(evaluateSavedSearchGate("full", true)).toBeNull();
  });
});
