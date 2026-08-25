import type { PlanTier } from "~/lib/plans";

export interface EntitlementProduct {
  productId: string;
  tier: Exclude<PlanTier, "free">;
}

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
 * True when any active subscription lacks a valid configured product ID. This
 * indicates a provider-shape or env/config problem
 * (e.g. legacy ID removed too early) rather than a genuine downgrade, so
 * callers must not strip entitlements based on it.
 */
export function hasUnrecognizedSubscriptions(
  state: CustomerStateLike,
  products: readonly EntitlementProduct[],
): boolean {
  const ids = subscriptionProductIds(state);
  const activeSubscriptionCount = state.activeSubscriptions?.length ?? 0;
  if (activeSubscriptionCount === 0) {
    return false;
  }
  if (ids.length !== activeSubscriptionCount) return true;
  return ids.some(
    (id) => !products.some((product) => product.productId === id),
  );
}

/**
 * Maps a Polar customer's active subscriptions to a plan tier.
 * Full wins over Lite if a customer somehow holds both. Pure so it can be
 * unit-tested without Polar credentials.
 */
export function resolvePlanTierFromCustomerState(
  state: CustomerStateLike,
  products: readonly EntitlementProduct[],
): PlanTier {
  const ids = new Set(subscriptionProductIds(state));
  if (
    products.some(
      ({ productId, tier }) => tier === "full" && ids.has(productId),
    )
  ) {
    return "full";
  }
  if (
    products.some(
      ({ productId, tier }) => tier === "lite" && ids.has(productId),
    )
  ) {
    return "lite";
  }
  return "free";
}
