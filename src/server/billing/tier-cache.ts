import type { PlanTier } from "~/lib/plans";

export interface TierCache {
  get: (userId: string) => PlanTier | null;
  set: (userId: string, tier: PlanTier) => void;
  invalidate: (userId: string) => void;
}

/**
 * Short-TTL in-memory cache for plan tiers. Entries expire after `ttlMs`;
 * expired entries are dropped on read. Injected clock keeps TTL behavior
 * testable.
 *
 * Eviction is lazy-on-read: churned users leave expired entries behind until
 * process recycle. Fine for serverless lifetimes; add a sweep or size cap
 * before using this in a long-lived worker.
 */
export function createTierCache(
  ttlMs: number,
  now: () => number = Date.now,
): TierCache {
  const entries = new Map<string, { tier: PlanTier; expiresAt: number }>();

  return {
    get(userId) {
      const entry = entries.get(userId);
      if (!entry) {
        return null;
      }
      if (entry.expiresAt <= now()) {
        entries.delete(userId);
        return null;
      }
      return entry.tier;
    },
    set(userId, tier) {
      entries.set(userId, { tier, expiresAt: now() + ttlMs });
    },
    invalidate(userId) {
      entries.delete(userId);
    },
  };
}
