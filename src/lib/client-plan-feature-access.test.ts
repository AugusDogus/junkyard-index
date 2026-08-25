import { describe, expect, test } from "bun:test";
import { resolveClientPlanFeatureAccess } from "~/lib/client-plan-feature-access";

describe("resolveClientPlanFeatureAccess", () => {
  test("locks client-only filters while account access is unresolved", () => {
    expect(
      resolveClientPlanFeatureAccess({
        access: { kind: "loading" },
        feature: "advanced_filters",
      }),
    ).toBe(false);
    expect(
      resolveClientPlanFeatureAccess({
        access: { kind: "unavailable", reason: "lookup_failed" },
        feature: "advanced_filters",
      }),
    ).toBe(false);
  });

  test("keeps server-authorized actions interactive while access resolves", () => {
    expect(
      resolveClientPlanFeatureAccess({
        access: { kind: "loading" },
        feature: "saved_searches",
      }),
    ).toBe(true);
    expect(
      resolveClientPlanFeatureAccess({
        access: { kind: "unavailable", reason: "lookup_failed" },
        feature: "alerts",
      }),
    ).toBe(true);
  });

  test("uses authoritative plan entitlement after access resolves", () => {
    expect(
      resolveClientPlanFeatureAccess({
        access: { kind: "resolved", tier: "lite" },
        feature: "saved_searches",
      }),
    ).toBe(true);
    expect(
      resolveClientPlanFeatureAccess({
        access: { kind: "resolved", tier: "lite" },
        feature: "alerts",
      }),
    ).toBe(false);
  });
});
