// Plan tier model. Pure module: safe to import from client and server code.
// Polar product ID mapping lives in src/server/billing (plan-tier.ts is the
// pure resolver; user-plan.ts binds it to configured product IDs).

export type PlanTier = "free" | "lite" | "full";

export type BillingInterval = "monthly" | "annual";

export const FREE_DAILY_SEARCH_LIMIT = 10;

const TIER_RANK: Record<PlanTier, number> = {
  free: 0,
  lite: 1,
  full: 2,
};

export function tierSatisfies(tier: PlanTier, required: PlanTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[required];
}

export type PlanFeature =
  | "advanced_filters"
  | "saved_searches"
  | "unlimited_searches"
  | "alerts";

// A feature gated at "free" would be no gate at all, so the map's values
// exclude it and the compiler rejects future gates that try.
const FEATURE_MIN_TIER: Record<PlanFeature, Exclude<PlanTier, "free">> = {
  advanced_filters: "lite",
  saved_searches: "lite",
  unlimited_searches: "lite",
  alerts: "full",
};

export function hasPlanFeature(tier: PlanTier, feature: PlanFeature): boolean {
  return tierSatisfies(tier, FEATURE_MIN_TIER[feature]);
}

/**
 * First unmet gate for creating a saved search (with optional alerts), in the
 * order the server enforces them: Lite is checked before Full so free users
 * are always pointed at the cheapest plan that unblocks them.
 * Returns null when nothing blocks the request.
 */
export function evaluateSavedSearchGate(
  tier: PlanTier,
  wantsAlerts: boolean,
): SavedSearchGateFeature | null {
  if (!hasPlanFeature(tier, "saved_searches")) {
    return "saved_searches";
  }
  if (wantsAlerts && !hasPlanFeature(tier, "alerts")) {
    return "alerts";
  }
  return null;
}

/** Features used as saved-search plan gates, shared by server and client. */
export type SavedSearchGateFeature = Extract<
  PlanFeature,
  "saved_searches" | "alerts"
>;

/**
 * The cheapest paid tier that unblocks saved-search creation for this tier.
 * The checkout-side counterpart of evaluateSavedSearchGate.
 */
export function savedSearchUpgradeTier(
  tier: PlanTier,
): Exclude<PlanTier, "free"> {
  return hasPlanFeature(tier, "saved_searches") ? "full" : "lite";
}

/** The tier a plan must reach to unlock a feature. */
export function featureUpgradeTier(
  feature: PlanFeature,
): Exclude<PlanTier, "free"> {
  return FEATURE_MIN_TIER[feature];
}

interface PlanDefinition {
  name: string;
  monthlyPrice: number;
  annualPrice: number;
}

export const PLANS: Record<PlanTier, PlanDefinition> = {
  free: { name: "Free", monthlyPrice: 0, annualPrice: 0 },
  lite: { name: "Lite", monthlyPrice: 3, annualPrice: 30 },
  full: { name: "Full", monthlyPrice: 7, annualPrice: 60 },
};

export function planPrice(
  tier: Exclude<PlanTier, "free">,
  interval: BillingInterval,
): number {
  return interval === "annual"
    ? PLANS[tier].annualPrice
    : PLANS[tier].monthlyPrice;
}

export function formatMonthlyEquivalent(
  tier: Exclude<PlanTier, "free">,
): string {
  const perMonth = PLANS[tier].annualPrice / 12;
  return Number.isInteger(perMonth)
    ? `$${perMonth}`
    : `$${perMonth.toFixed(2)}`;
}

/** UTC-day bucket key (YYYY-MM-DD). Quotas reset at midnight UTC. */
export function currentUtcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
