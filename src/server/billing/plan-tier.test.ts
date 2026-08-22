import { describe, expect, test } from "bun:test";
import { type PlanTier, CHECKOUT_SLUGS, checkoutSlugFor } from "~/lib/plans";
import {
  type PolarProductIds,
  type CustomerStateLike,
  resolvePlanTierFromCustomerState,
} from "~/server/billing/plan-tier";

const IDS: PolarProductIds = {
  lite: ["lite-monthly", "lite-annual"],
  full: ["full-monthly", "full-annual"],
  legacy: "legacy-email-notifications",
};

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
      resolvePlanTierFromCustomerState({ activeSubscriptions: [] }, IDS),
    ).toBe("free");
    expect(resolvePlanTierFromCustomerState({}, IDS)).toBe("free");
  });

  test("legacy subscribers are grandfathered as full", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith("legacy-email-notifications"),
      IDS,
    );
    expect(tier).toBe("full");
  });

  test("monthly and annual products map to their tier", () => {
    expect(
      resolvePlanTierFromCustomerState(stateWith("lite-monthly"), IDS),
    ).toBe("lite");
    expect(
      resolvePlanTierFromCustomerState(stateWith("lite-annual"), IDS),
    ).toBe("lite");
    expect(
      resolvePlanTierFromCustomerState(stateWith("full-monthly"), IDS),
    ).toBe("full");
    expect(
      resolvePlanTierFromCustomerState(stateWith("full-annual"), IDS),
    ).toBe("full");
  });

  test("full wins over lite when both are held", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith("lite-monthly", "full-monthly"),
      IDS,
    );
    expect(tier).toBe<PlanTier>("full");
  });

  test("unknown product ids resolve to free", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith("some-other-product"),
      IDS,
    );
    expect(tier).toBe<PlanTier>("free");
  });

  test("reads product.id when productId is missing", () => {
    const tier = resolvePlanTierFromCustomerState(
      stateWith({ product: { id: "lite-annual" } }),
      IDS,
    );
    expect(tier).toBe<PlanTier>("lite");
  });
});

describe("checkoutSlugFor", () => {
  test("maps tier and interval to the configured slugs", () => {
    expect(checkoutSlugFor("lite", "monthly")).toBe(
      CHECKOUT_SLUGS.lite_monthly,
    );
    expect(checkoutSlugFor("lite", "annual")).toBe(CHECKOUT_SLUGS.lite_annual);
    expect(checkoutSlugFor("full", "monthly")).toBe(
      CHECKOUT_SLUGS.full_monthly,
    );
    expect(checkoutSlugFor("full", "annual")).toBe(CHECKOUT_SLUGS.full_annual);
  });
});
