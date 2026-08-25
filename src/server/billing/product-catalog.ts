import type { BillingInterval, PaidPlanTier } from "~/lib/plans";
import type { EntitlementProduct } from "~/server/billing/plan-tier";

export type BillingProductKey = `${PaidPlanTier}_${BillingInterval}`;

export type CheckoutBillingProduct = {
  kind: "checkout";
  key: BillingProductKey;
  tier: PaidPlanTier;
  interval: BillingInterval;
  productId: string;
};

export type BillingProduct =
  | CheckoutBillingProduct
  | { kind: "legacy"; productId: string };

export type BillingProductIds = Record<BillingProductKey, string>;

export interface BillingProductCatalog {
  checkoutProducts: Readonly<Record<BillingProductKey, CheckoutBillingProduct>>;
  allProducts: readonly BillingProduct[];
  entitlementProducts: readonly EntitlementProduct[];
  productById: ReadonlyMap<string, BillingProduct>;
}

function checkoutProduct(
  ids: BillingProductIds,
  tier: PaidPlanTier,
  interval: BillingInterval,
): CheckoutBillingProduct {
  const key = getBillingProductKey(tier, interval);
  return { kind: "checkout", key, tier, interval, productId: ids[key] };
}

export function createBillingProductCatalog(input: {
  checkoutProductIds: BillingProductIds;
  legacyProductId?: string;
}): BillingProductCatalog {
  const checkoutProducts: Record<BillingProductKey, CheckoutBillingProduct> = {
    lite_monthly: checkoutProduct(input.checkoutProductIds, "lite", "monthly"),
    lite_annual: checkoutProduct(input.checkoutProductIds, "lite", "annual"),
    full_monthly: checkoutProduct(input.checkoutProductIds, "full", "monthly"),
    full_annual: checkoutProduct(input.checkoutProductIds, "full", "annual"),
  };
  const allProducts: readonly BillingProduct[] = [
    ...Object.values(checkoutProducts),
    ...(input.legacyProductId
      ? [{ kind: "legacy" as const, productId: input.legacyProductId }]
      : []),
  ];
  const seenProductIds = new Set<string>();
  for (const product of allProducts) {
    if (seenProductIds.has(product.productId)) {
      throw new Error(
        `Billing product ID ${product.productId} is configured more than once. Each checkout and legacy product must use a unique ID.`,
      );
    }
    seenProductIds.add(product.productId);
  }
  return {
    checkoutProducts,
    allProducts,
    entitlementProducts: allProducts.map((product) => ({
      productId: product.productId,
      tier: product.kind === "legacy" ? "full" : product.tier,
    })),
    productById: new Map(
      allProducts.map((product) => [product.productId, product]),
    ),
  };
}

export function getBillingProductKey(
  tier: PaidPlanTier,
  interval: BillingInterval,
): BillingProductKey {
  return `${tier}_${interval}`;
}
