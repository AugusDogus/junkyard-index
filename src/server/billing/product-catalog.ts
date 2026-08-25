import { env } from "~/env";
import type { BillingInterval, PlanTier } from "~/lib/plans";

type PaidTier = Exclude<PlanTier, "free">;
export type BillingProductKey = `${PaidTier}_${BillingInterval}`;

export type CheckoutBillingProduct = {
  kind: "checkout";
  key: BillingProductKey;
  productId: string;
  tier: PaidTier;
  interval: BillingInterval;
};

export type BillingProduct =
  | CheckoutBillingProduct
  | { kind: "legacy"; productId: string; tier: "full" };

export function getBillingProductCatalog(): readonly BillingProduct[] {
  return [
    {
      kind: "checkout",
      key: "lite_monthly",
      productId: env.POLAR_LITE_PRODUCT_ID,
      tier: "lite",
      interval: "monthly",
    },
    {
      kind: "checkout",
      key: "lite_annual",
      productId: env.POLAR_LITE_ANNUAL_PRODUCT_ID,
      tier: "lite",
      interval: "annual",
    },
    {
      kind: "checkout",
      key: "full_monthly",
      productId: env.POLAR_FULL_PRODUCT_ID,
      tier: "full",
      interval: "monthly",
    },
    {
      kind: "checkout",
      key: "full_annual",
      productId: env.POLAR_FULL_ANNUAL_PRODUCT_ID,
      tier: "full",
      interval: "annual",
    },
    ...(env.POLAR_PRODUCT_ID
      ? [
          {
            kind: "legacy" as const,
            productId: env.POLAR_PRODUCT_ID,
            tier: "full" as const,
          },
        ]
      : []),
  ];
}

export function getCheckoutBillingProducts(): readonly CheckoutBillingProduct[] {
  return getBillingProductCatalog().filter(
    (product): product is CheckoutBillingProduct => product.kind === "checkout",
  );
}

export function getBillingProductKey(
  tier: PaidTier,
  interval: BillingInterval,
): BillingProductKey {
  return `${tier}_${interval}`;
}
