import {
  BILLING_INTERVALS,
  PAID_PLAN_TIERS,
  type BillingInterval,
  type PaidPlanTier,
} from "~/lib/plans";

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

export function createBillingProductCatalog(input: {
  checkoutProductIds: BillingProductIds;
  legacyProductId?: string;
}): readonly BillingProduct[] {
  const checkoutProducts = PAID_PLAN_TIERS.flatMap((tier) =>
    BILLING_INTERVALS.map((interval) => {
      const key = getBillingProductKey(tier, interval);
      return {
        kind: "checkout" as const,
        key,
        tier,
        interval,
        productId: input.checkoutProductIds[key],
      };
    }),
  );
  const catalog: readonly BillingProduct[] = [
    ...checkoutProducts,
    ...(input.legacyProductId
      ? [{ kind: "legacy" as const, productId: input.legacyProductId }]
      : []),
  ];
  const seenProductIds = new Set<string>();
  for (const product of catalog) {
    if (seenProductIds.has(product.productId)) {
      throw new Error(
        `Billing product ID ${product.productId} is configured more than once. Each checkout and legacy product must use a unique ID.`,
      );
    }
    seenProductIds.add(product.productId);
  }
  return catalog;
}

export function getCheckoutBillingProducts(
  catalog: readonly BillingProduct[],
): readonly CheckoutBillingProduct[] {
  return catalog.filter(
    (product): product is CheckoutBillingProduct => product.kind === "checkout",
  );
}

export function getBillingProductKey(
  tier: PaidPlanTier,
  interval: BillingInterval,
): BillingProductKey {
  return `${tier}_${interval}`;
}

export function getBillingProductTier(product: BillingProduct): PaidPlanTier {
  return product.kind === "legacy" ? "full" : product.tier;
}
