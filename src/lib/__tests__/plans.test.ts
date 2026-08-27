import { describe, expect, test } from "bun:test";
import {
  PLANS,
  evaluateSavedSearchGate,
  formatMonthlyEquivalent,
  hasPlanFeature,
  planPrice,
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
