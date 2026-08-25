import { env } from "~/env";
import {
  createBillingProductCatalog,
  getBillingProductTier,
  getCheckoutBillingProducts,
} from "./product-catalog";

export const billingProductCatalog = createBillingProductCatalog({
  checkoutProductIds: {
    lite_monthly: env.POLAR_LITE_PRODUCT_ID,
    lite_annual: env.POLAR_LITE_ANNUAL_PRODUCT_ID,
    full_monthly: env.POLAR_FULL_PRODUCT_ID,
    full_annual: env.POLAR_FULL_ANNUAL_PRODUCT_ID,
  },
  ...(env.POLAR_PRODUCT_ID ? { legacyProductId: env.POLAR_PRODUCT_ID } : {}),
});

export const checkoutBillingProducts = getCheckoutBillingProducts(
  billingProductCatalog,
);

export const entitlementBillingProducts = billingProductCatalog.map(
  (product) => ({
    productId: product.productId,
    tier: getBillingProductTier(product),
  }),
);
