import { describe, expect, test } from "bun:test";
import {
  createBillingProductCatalog,
  getBillingProductTier,
  getCheckoutBillingProducts,
  parseBillingProductKey,
} from "./product-catalog";

const PRODUCT_IDS = {
  lite_monthly: "lite-monthly-id",
  lite_annual: "lite-annual-id",
  full_monthly: "full-monthly-id",
  full_annual: "full-annual-id",
};

describe("billing product catalog", () => {
  test("derives tier and interval from the canonical product key", () => {
    expect(parseBillingProductKey("lite_monthly")).toEqual({
      tier: "lite",
      interval: "monthly",
    });
    expect(parseBillingProductKey("full_annual")).toEqual({
      tier: "full",
      interval: "annual",
    });
  });

  test("keeps legacy products recognizable but not checkoutable", () => {
    const catalog = createBillingProductCatalog({
      checkoutProductIds: PRODUCT_IDS,
      legacyProductId: "legacy-id",
    });
    expect(getCheckoutBillingProducts(catalog)).toHaveLength(4);
    const legacy = catalog.find((product) => product.kind === "legacy");
    expect(legacy?.productId).toBe("legacy-id");
    expect(legacy ? getBillingProductTier(legacy) : null).toBe("full");
  });
});
