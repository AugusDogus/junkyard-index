import type { PlanTier } from "~/lib/plans";
import type { CustomerStateLike } from "./plan-tier";
import { createTierCache } from "./tier-cache";

export interface PlanTierService {
  getPlanTier(userId: string): Promise<PlanTier>;
  getFreshPlanTier(userId: string): Promise<PlanTier>;
}

export function createPlanTierService(options: {
  fetchCustomerState: (externalId: string) => Promise<CustomerStateLike>;
  resolveTier: (state: CustomerStateLike) => PlanTier;
  ttlMs?: number;
  onError?: (userId: string, error: unknown) => void;
}): PlanTierService {
  const {
    fetchCustomerState,
    resolveTier,
    ttlMs = 60_000,
    onError = (userId, error) =>
      console.error(
        `Failed to resolve plan tier from Polar for user ${userId}; treating as free.`,
        error,
      ),
  } = options;
  const cache = createTierCache(ttlMs);

  const fetchResolved = async (userId: string): Promise<PlanTier> =>
    resolveTier(await fetchCustomerState(userId));

  const resolveFresh = async (userId: string): Promise<PlanTier> => {
    try {
      return await fetchResolved(userId);
    } catch (error) {
      onError(userId, error);
      return "free";
    }
  };

  return {
    async getPlanTier(userId) {
      const cached = cache.get(userId);
      if (cached !== null) return cached;
      try {
        const tier = await fetchResolved(userId);
        cache.set(userId, tier);
        return tier;
      } catch (error) {
        onError(userId, error);
        return "free";
      }
    },
    getFreshPlanTier: resolveFresh,
  };
}
