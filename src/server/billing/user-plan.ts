import { env } from "~/env";
import type { PlanTier } from "~/lib/plans";
import { polarClient } from "~/lib/polar";
import {
  hasUnrecognizedSubscriptions as hasUnrecognizedSubscriptionsImpl,
  resolvePlanTierFromCustomerState,
  type CustomerStateLike,
} from "./plan-tier";
import { createPlanTierService } from "./plan-tier-service";
import {
  billingProductCatalog,
  entitlementBillingProducts,
} from "./configured-product-catalog";

/** True when an active subscription has no configured product. */
export function hasUnrecognizedSubscriptions(
  state: CustomerStateLike,
): boolean {
  return hasUnrecognizedSubscriptionsImpl(state, billingProductCatalog);
}

/** Resolves a Polar customer state to a plan tier using configured products. */
export function resolveCustomerPlanTier(state: CustomerStateLike): PlanTier {
  return resolvePlanTierFromCustomerState(state, entitlementBillingProducts);
}

if (!env.POLAR_PRODUCT_ID) {
  console.warn(
    "POLAR_PRODUCT_ID is not set: legacy Email-Notifications subscribers will NOT be grandfathered as Full. " +
      "Keep it configured until every legacy subscription has churned.",
  );
}

const defaultService = createPlanTierService({
  fetchCustomerState: (externalId) =>
    polarClient.customers.getStateExternal({ externalId }),
  resolveTier: resolveCustomerPlanTier,
});

/**
 * Resolves the user's plan tier from Polar, cached briefly because it sits on
 * hot paths (per recorded search, client tier fetches). Tier changes may
 * remain stale for at most the TTL on serverless instances.
 * Any Polar failure resolves to "free" so transient errors never grant paid
 * features.
 */
export async function getPlanTier(userId: string): Promise<PlanTier> {
  return defaultService.getPlanTier(userId);
}

/** Resolves authoritative state without consulting or updating the UI cache. */
export async function getFreshPlanTier(userId: string): Promise<PlanTier> {
  return defaultService.getFreshPlanTier(userId);
}
