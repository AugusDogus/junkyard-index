import { polarClient } from "./polar-client";
import { env } from "~/env";
import type { PlanTier } from "~/lib/plans";
import {
  hasUnrecognizedSubscriptions as hasUnrecognizedSubscriptionsImpl,
  resolvePlanTierFromCustomerState,
  type CustomerStateLike,
} from "./plan-tier";
import { createTierCache } from "./tier-cache";

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

/** True when active subscriptions match no configured product (config problem). */
export function hasUnrecognizedSubscriptions(
  state: CustomerStateLike,
): boolean {
  return hasUnrecognizedSubscriptionsImpl(state, getCurrentPolarProductIds());
}

/** Resolves a Polar customer state to a plan tier using configured products. */
export function resolveCustomerPlanTier(state: CustomerStateLike): PlanTier {
  return resolvePlanTierFromCustomerState(state, getCurrentPolarProductIds());
}

const TIER_CACHE_TTL_MS = 60_000;

if (!env.POLAR_PRODUCT_ID) {
  console.warn(
    "POLAR_PRODUCT_ID is not set: legacy Email-Notifications subscribers will NOT be grandfathered as Full. " +
      "Keep it configured until every legacy subscription has churned.",
  );
}

export interface PlanTierService {
  getPlanTier(userId: string): Promise<PlanTier>;
  invalidateCache(userId: string): void;
}

/**
 * Builds the cached plan-tier service. Injectable fetcher keeps cache and
 * fail-closed behavior testable without touching Polar.
 */
export function createPlanTierService(options: {
  fetchCustomerState: (externalId: string) => Promise<CustomerStateLike>;
  resolveTier?: (state: CustomerStateLike) => PlanTier;
  ttlMs?: number;
  onError?: (userId: string, error: unknown) => void;
}): PlanTierService {
  const {
    fetchCustomerState,
    resolveTier = resolveCustomerPlanTier,
    ttlMs = TIER_CACHE_TTL_MS,
    onError = (userId, error) =>
      console.error(
        `Failed to resolve plan tier from Polar for user ${userId}; treating as free.`,
        error,
      ),
  } = options;
  const cache = createTierCache(ttlMs);

  return {
    async getPlanTier(userId) {
      const cached = cache.get(userId);
      if (cached !== null) {
        return cached;
      }

      try {
        const customerState = await fetchCustomerState(userId);
        const tier = resolveTier(customerState);
        cache.set(userId, tier);
        return tier;
      } catch (error) {
        // Failures are logged and never cached so a transient Polar error
        // cannot lock a paying user out for the TTL window.
        onError(userId, error);
        return "free";
      }
    },
    invalidateCache(userId) {
      cache.invalidate(userId);
    },
  };
}

const defaultService = createPlanTierService({
  fetchCustomerState: (externalId) =>
    polarClient.customers.getStateExternal({ externalId }),
});

/** Drops the cached tier so the next getPlanTier call hits Polar again. */
export function invalidatePlanTierCache(userId: string): void {
  defaultService.invalidateCache(userId);
}

/**
 * Resolves the user's plan tier from Polar, cached briefly because it sits on
 * hot paths (per recorded search, client tier polling). Cache entries are
 * invalidated by subscription webhooks so upgrades land promptly. Any Polar
 * failure resolves to "free" so transient errors never grant paid features.
 */
export async function getPlanTier(userId: string): Promise<PlanTier> {
  return defaultService.getPlanTier(userId);
}
