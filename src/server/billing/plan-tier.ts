import type { PaidPlanTier, PlanTier } from "~/lib/plans";

export interface EntitlementProduct {
  productId: string;
  tier: PaidPlanTier;
}

export type PlanTierResolution =
  | { kind: "resolved"; tier: PlanTier }
  | { kind: "unrecognized"; activeSubscriptionCount: number };

interface SubscriptionLike {
  productId?: unknown;
  product?: { id?: unknown } | null;
}

export interface CustomerStateLike {
  activeSubscriptions?: readonly SubscriptionLike[] | null;
}

function subscriptionProductIds(state: CustomerStateLike): string[] {
  return (state.activeSubscriptions ?? [])
    .map((subscription) => {
      if (typeof subscription.productId === "string") {
        return subscription.productId;
      }
      if (typeof subscription.product?.id === "string") {
        return subscription.product.id;
      }
      return "";
    })
    .filter((productId) => productId.length > 0);
}

/**
 * Maps a Polar customer's active subscriptions to a plan tier.
 * Full wins over Lite if a customer somehow holds both. Pure so it can be
 * unit-tested without Polar credentials.
 */
export function resolvePlanTierFromCustomerState(
  state: CustomerStateLike,
  products: readonly EntitlementProduct[],
): PlanTierResolution {
  const activeSubscriptionCount = state.activeSubscriptions?.length ?? 0;
  const productIds = subscriptionProductIds(state);
  const ids = new Set(productIds);
  if (
    productIds.length !== activeSubscriptionCount ||
    [...ids].some((id) => !products.some((product) => product.productId === id))
  ) {
    return { kind: "unrecognized", activeSubscriptionCount };
  }
  if (
    products.some(
      ({ productId, tier }) => tier === "full" && ids.has(productId),
    )
  ) {
    return { kind: "resolved", tier: "full" };
  }
  if (
    products.some(
      ({ productId, tier }) => tier === "lite" && ids.has(productId),
    )
  ) {
    return { kind: "resolved", tier: "lite" };
  }
  return { kind: "resolved", tier: "free" };
}
