import { describe, expect, test } from "bun:test";
import { type PlanTier } from "~/lib/plans";
import {
  type EntitlementProduct,
  type CustomerStateLike,
  hasUnrecognizedSubscriptions,
  resolvePlanTierFromCustomerState,
} from "~/server/billing/plan-tier";

const PRODUCTS: readonly EntitlementProduct[] = [
  { productId: "lite-monthly", tier: "lite" },
  { productId: "lite-annual", tier: "lite" },
  { productId: "full-monthly", tier: "full" },
  { productId: "full-annual", tier: "full" },
  { productId: "legacy-email-notifications", tier: "full" },
];

function stateWith(
  ...productIds: (string | { productId?: string; product?: { id: string } })[]
): CustomerStateLike {
  return {
    activeSubscriptions: productIds.map((id) =>
      typeof id === "string" ? { productId: id } : id,
    ),
  };
}

describe("resolvePlanTierFromCustomerState", () => {
  test("no subscriptions resolves to free", () => {
    expect(
      resolvePlanTierFromCustomerState({ activeSubscriptions: [] }, PRODUCTS),
    ).toBe("free");
    expect(resolvePlanTierFromCustomerState({}, PRODUCTS)).toBe("free");
  });

  test("legacy subscribers are grandfathered as full", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith("legacy-email-notifications"),
      PRODUCTS,
    );
    expect(tier).toBe("full");
  });

  test("monthly and annual products map to their tier", () => {
    expect(
      resolvePlanTierFromCustomerState(stateWith("lite-monthly"), PRODUCTS),
    ).toBe("lite");
    expect(
      resolvePlanTierFromCustomerState(stateWith("lite-annual"), PRODUCTS),
    ).toBe("lite");
    expect(
      resolvePlanTierFromCustomerState(stateWith("full-monthly"), PRODUCTS),
    ).toBe("full");
    expect(
      resolvePlanTierFromCustomerState(stateWith("full-annual"), PRODUCTS),
    ).toBe("full");
  });

  test("full wins over lite when both are held", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith("lite-monthly", "full-monthly"),
      PRODUCTS,
    );
    expect(tier).toBe<PlanTier>("full");
  });

  test("unknown product ids resolve to free", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith("some-other-product"),
      PRODUCTS,
    );
    expect(tier).toBe<PlanTier>("free");
  });

  test("reads product.id when productId is missing", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith({ product: { id: "lite-annual" } }),
      PRODUCTS,
    );
    expect(tier).toBe<PlanTier>("lite");
  });

  test("reports malformed and mixed unknown active subscriptions", () => {
    expect(
      hasUnrecognizedSubscriptions({ activeSubscriptions: [{}] }, PRODUCTS),
    ).toBe(true);
    expect(
      hasUnrecognizedSubscriptions(
        stateWith("lite-monthly", "unknown-product"),
        PRODUCTS,
      ),
    ).toBe(true);
  });
});
