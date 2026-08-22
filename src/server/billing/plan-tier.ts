import type { PlanTier } from "~/lib/plans";

export interface PolarProductIds {
  lite: string[];
  full: string[];
  /** Legacy "Email-Notifications" product; subscribers are grandfathered as Full. */
  legacy?: string;
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
 * True when the customer holds active subscriptions but none of their product
 * IDs match the configured products. This indicates an env/config problem
 * (e.g. legacy ID removed too early) rather than a genuine downgrade, so
 * callers must not strip entitlements based on it.
 */
export function hasUnrecognizedSubscriptions(
  state: CustomerStateLike,
  productIds: PolarProductIds,
): boolean {
  const ids = subscriptionProductIds(state);
  if (ids.length === 0) {
    return false;
  }
  return !ids.some(
    (id) =>
      id === productIds.legacy ||
      productIds.lite.includes(id) ||
      productIds.full.includes(id),
  );
}

/**
 * Maps a Polar customer's active subscriptions to a plan tier.
 * Full wins over Lite if a customer somehow holds both. Pure so it can be
 * unit-tested without Polar credentials.
 */
export function resolvePlanTierFromCustomerState(
  state: CustomerStateLike,
  productIds: PolarProductIds,
): PlanTier {
  const ids = new Set(subscriptionProductIds(state));
  if (
    ids.has(productIds.legacy ?? "") ||
    productIds.full.some((id) => ids.has(id))
  ) {
    return "full";
  }
  if (productIds.lite.some((id) => ids.has(id))) {
    return "lite";
  }
  return "free";
}
