import { describe, expect, test } from "bun:test";
import {
  createBillingProductCatalog,
  getBillingProductKey,
} from "./product-catalog";

const PRODUCT_IDS = {
  lite_monthly: "lite-monthly-id",
  lite_annual: "lite-annual-id",
  full_monthly: "full-monthly-id",
  full_annual: "full-annual-id",
};

describe("billing product catalog", () => {
  test("derives tier and interval from the canonical product key", () => {
    expect(getBillingProductKey("lite", "monthly")).toBe("lite_monthly");
    expect(getBillingProductKey("full", "annual")).toBe("full_annual");
    const catalog = createBillingProductCatalog({
      checkoutProductIds: PRODUCT_IDS,
    });
    expect(Object.values(catalog.checkoutProducts)).toEqual([
      {
        kind: "checkout",
        key: "lite_monthly",
        tier: "lite",
        interval: "monthly",
        productId: "lite-monthly-id",
      },
      {
        kind: "checkout",
        key: "lite_annual",
        tier: "lite",
        interval: "annual",
        productId: "lite-annual-id",
      },
      {
        kind: "checkout",
        key: "full_monthly",
        tier: "full",
        interval: "monthly",
        productId: "full-monthly-id",
      },
      {
        kind: "checkout",
        key: "full_annual",
        tier: "full",
        interval: "annual",
        productId: "full-annual-id",
      },
    ]);
  });

  test("keeps legacy products recognizable but not checkoutable", () => {
    const catalog = createBillingProductCatalog({
      checkoutProductIds: PRODUCT_IDS,
      legacyProductId: "legacy-id",
    });
    expect(Object.values(catalog.checkoutProducts)).toHaveLength(4);
    const legacy = catalog.allProducts.find(
      (product) => product.kind === "legacy",
    );
    expect(legacy?.productId).toBe("legacy-id");
    expect(
      catalog.entitlementProducts.find(
        (product) => product.productId === "legacy-id",
      )?.tier,
    ).toBe("full");
    expect(catalog.productById.get("legacy-id")).toEqual(legacy);
  });

  test("rejects duplicate checkout and legacy product IDs", () => {
    expect(() =>
      createBillingProductCatalog({
        checkoutProductIds: {
          ...PRODUCT_IDS,
          full_monthly: PRODUCT_IDS.lite_monthly,
        },
      }),
    ).toThrow("configured more than once");

    expect(() =>
      createBillingProductCatalog({
        checkoutProductIds: PRODUCT_IDS,
        legacyProductId: PRODUCT_IDS.lite_monthly,
      }),
    ).toThrow("configured more than once");
  });
});
