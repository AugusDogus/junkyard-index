import { env } from "~/env";
import type { PlanTier } from "~/lib/plans";
import { polarClient } from "~/lib/polar";
import {
  resolvePlanTierFromCustomerState,
  type CustomerStateLike,
  type PlanTierResolution,
} from "./plan-tier";
import { createPlanTierService } from "./plan-tier-service";
import { entitlementBillingProducts } from "./configured-product-catalog";

/** Resolves configured entitlements without collapsing unknown products. */
export function resolveCustomerPlanTier(
  state: CustomerStateLike,
): PlanTierResolution {
  return resolvePlanTierFromCustomerState(state, entitlementBillingProducts);
}

function resolveCustomerPlanTierForAccess(state: CustomerStateLike): PlanTier {
  const resolution = resolveCustomerPlanTier(state);
  if (resolution.kind === "unrecognized") {
    throw new Error(
      `Polar returned ${resolution.activeSubscriptionCount} active subscription(s) matching no configured product.`,
    );
  }
  return resolution.tier;
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
  resolveTier: resolveCustomerPlanTierForAccess,
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

/** Refreshes authoritative state and replaces the local UI cache entry. */
export async function refreshPlanTier(userId: string): Promise<PlanTier> {
  return defaultService.refreshPlanTier(userId);
}

/** Reuses an authoritative tier already resolved from the same customer snapshot. */
export function rememberPlanTier(userId: string, tier: PlanTier): void {
  defaultService.rememberPlanTier(userId, tier);
}
