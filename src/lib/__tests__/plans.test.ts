import { describe, expect, test } from "bun:test";
import {
  FREE_DAILY_SEARCH_LIMIT,
  PLANS,
  evaluateSavedSearchGate,
  featureUpgradeTier,
  formatMonthlyEquivalent,
  hasPlanFeature,
  planPrice,
  resolvePlanFeatureAccess,
  resolvedPlanTier,
  savedSearchUpgradeTier,
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
    expect(resolvedPlanTier({ kind: "unavailable" })).toBeNull();
    expect(resolvedPlanTier({ kind: "resolved", tier: "lite" })).toBe("lite");
    expect(
      resolvePlanFeatureAccess({
        access: { kind: "unavailable" },
        feature: "advanced_filters",
      }),
    ).toBe(false);
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

  test("upgrade tier is the cheapest plan that unblocks saved searches", () => {
    expect(savedSearchUpgradeTier("free")).toBe("lite");
    expect(savedSearchUpgradeTier("lite")).toBe("full");
    expect(savedSearchUpgradeTier("full")).toBe("full");
  });
});

describe("featureUpgradeTier", () => {
  test("maps each gated feature to its minimum paid tier", () => {
    expect(featureUpgradeTier("advanced_filters")).toBe("lite");
    expect(featureUpgradeTier("saved_searches")).toBe("lite");
    expect(featureUpgradeTier("unlimited_searches")).toBe("lite");
    expect(featureUpgradeTier("alerts")).toBe("full");
  });

  test("agrees with the gate evaluation for every feature and tier", () => {
    const tiers = ["free", "lite", "full"] as const;
    for (const tier of tiers) {
      for (const feature of [
        "advanced_filters",
        "saved_searches",
        "unlimited_searches",
        "alerts",
      ] as const) {
        const locked = !hasPlanFeature(tier, feature);
        const upgrade = featureUpgradeTier(feature);
        // If the feature is locked at this tier, the upgrade tier must
        // actually unlock it; otherwise it must already satisfy the gate.
        if (locked) {
          expect(hasPlanFeature(upgrade, feature)).toBe(true);
        } else {
          expect(tierSatisfies(tier, upgrade)).toBe(true);
        }
      }
    }
  });
});
