import { polarClient } from "./polar-client";
import { env } from "~/env";
import type { PlanTier } from "~/lib/plans";
import {
  resolvePlanTierFromCustomerState,
  type CustomerStateLike,
} from "./plan-tier";

/**
 * Single source of truth for Polar product ID -> tier mapping. Legacy
 * "Email-Notifications" subscribers are grandfathered as Full so they keep
 * the alerts they pay for.
 */
export function getCurrentPolarProductIds() {
  return {
    lite: [env.POLAR_LITE_PRODUCT_ID, env.POLAR_LITE_ANNUAL_PRODUCT_ID],
    full: [env.POLAR_FULL_PRODUCT_ID, env.POLAR_FULL_ANNUAL_PRODUCT_ID],
    ...(env.POLAR_PRODUCT_ID ? { legacy: env.POLAR_PRODUCT_ID } : {}),
  };
}

/** Resolves a Polar customer state to a plan tier using configured products. */
export function resolveCustomerPlanTier(state: CustomerStateLike): PlanTier {
  return resolvePlanTierFromCustomerState(state, getCurrentPolarProductIds());
}

const TIER_CACHE_TTL_MS = 60_000;
const tierCache = new Map<string, { tier: PlanTier; expiresAt: number }>();

/** Drops the cached tier so the next getPlanTier call hits Polar again. */
export function invalidatePlanTierCache(userId: string): void {
  tierCache.delete(userId);
}

/**
 * Resolves the user's plan tier from Polar, cached briefly because it sits on
 * hot paths (per recorded search, client tier polling). Cache entries are
 * invalidated by subscription webhooks so upgrades land promptly. Any Polar
 * failure resolves to "free" so transient errors never grant paid features;
 * failures are logged and never cached.
 */
export async function getPlanTier(userId: string): Promise<PlanTier> {
  const cached = tierCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.tier;
  }

  try {
    const customerState = await polarClient.customers.getStateExternal({
      externalId: userId,
    });
    const tier = resolveCustomerPlanTier(customerState);
    tierCache.set(userId, {
      tier,
      expiresAt: Date.now() + TIER_CACHE_TTL_MS,
    });
    return tier;
  } catch (error) {
    console.error(
      `Failed to resolve plan tier from Polar for user ${userId}; treating as free.`,
      error,
    );
    return "free";
  }
}
