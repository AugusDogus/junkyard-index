import type { BillingInterval, PlanTier } from "~/lib/plans";

type PaidTier = Exclude<PlanTier, "free">;

export const BILLING_PRODUCT_KEYS = [
  "lite_monthly",
  "lite_annual",
  "full_monthly",
  "full_annual",
] as const;

export type BillingProductKey = (typeof BILLING_PRODUCT_KEYS)[number];

export type CheckoutBillingProduct = {
  kind: "checkout";
  key: BillingProductKey;
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
  const checkoutProducts = BILLING_PRODUCT_KEYS.map((key) => ({
    kind: "checkout" as const,
    key,
    productId: input.checkoutProductIds[key],
  }));
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
  tier: PaidTier,
  interval: BillingInterval,
): BillingProductKey {
  return `${tier}_${interval}`;
}

export function parseBillingProductKey(key: BillingProductKey): {
  tier: PaidTier;
  interval: BillingInterval;
} {
  switch (key) {
    case "lite_monthly":
      return { tier: "lite", interval: "monthly" };
    case "lite_annual":
      return { tier: "lite", interval: "annual" };
    case "full_monthly":
      return { tier: "full", interval: "monthly" };
    case "full_annual":
      return { tier: "full", interval: "annual" };
  }
}

export function getBillingProductTier(product: BillingProduct): PaidTier {
  return product.kind === "legacy"
    ? "full"
    : parseBillingProductKey(product.key).tier;
}
