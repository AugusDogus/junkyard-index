import { describe, expect, test } from "bun:test";
import {
  type EntitlementProduct,
  type CustomerStateLike,
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
    ).toEqual({ kind: "resolved", tier: "free" });
    expect(resolvePlanTierFromCustomerState({}, PRODUCTS)).toEqual({
      kind: "resolved",
      tier: "free",
    });
  });

  test("legacy subscribers are grandfathered as full", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith("legacy-email-notifications"),
      PRODUCTS,
    );
    expect(tier).toEqual({ kind: "resolved", tier: "full" });
  });

  test("monthly and annual products map to their tier", () => {
    expect(
      resolvePlanTierFromCustomerState(stateWith("lite-monthly"), PRODUCTS),
    ).toEqual({ kind: "resolved", tier: "lite" });
    expect(
      resolvePlanTierFromCustomerState(stateWith("lite-annual"), PRODUCTS),
    ).toEqual({ kind: "resolved", tier: "lite" });
    expect(
      resolvePlanTierFromCustomerState(stateWith("full-monthly"), PRODUCTS),
    ).toEqual({ kind: "resolved", tier: "full" });
    expect(
      resolvePlanTierFromCustomerState(stateWith("full-annual"), PRODUCTS),
    ).toEqual({ kind: "resolved", tier: "full" });
  });

  test("full wins over lite when both are held", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith("lite-monthly", "full-monthly"),
      PRODUCTS,
    );
    expect(tier).toEqual({ kind: "resolved", tier: "full" });
  });

  test("unknown product ids remain an explicit unresolved state", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith("some-other-product"),
      PRODUCTS,
    );
    expect(tier).toEqual({
      kind: "unrecognized",
      activeSubscriptionCount: 1,
    });
  });

  test("reads product.id when productId is missing", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith({ product: { id: "lite-annual" } }),
      PRODUCTS,
    );
    expect(tier).toEqual({ kind: "resolved", tier: "lite" });
  });

  test("reports malformed and mixed unknown active subscriptions", () => {
    expect(
      resolvePlanTierFromCustomerState({ activeSubscriptions: [{}] }, PRODUCTS),
    ).toEqual({ kind: "unrecognized", activeSubscriptionCount: 1 });
    expect(
      resolvePlanTierFromCustomerState(
        stateWith("lite-monthly", "unknown-product"),
        PRODUCTS,
      ),
    ).toEqual({ kind: "unrecognized", activeSubscriptionCount: 2 });
  });
});
