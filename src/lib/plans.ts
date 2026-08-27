// Plan tier model. Pure module: safe to import from client and server code.
// Polar product ID mapping lives in src/server/billing (plan-tier.ts is the
// pure resolver; user-plan.ts binds it to configured product IDs).

export const PAID_PLAN_TIERS = ["lite", "full"] as const;
export type PaidPlanTier = (typeof PAID_PLAN_TIERS)[number];
export const PLAN_TIERS = ["free", ...PAID_PLAN_TIERS] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const BILLING_INTERVALS = ["monthly", "annual"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export function isPaidPlanTier(value: unknown): value is PaidPlanTier {
  return PAID_PLAN_TIERS.some((tier) => tier === value);
}

export function isBillingInterval(value: unknown): value is BillingInterval {
  return BILLING_INTERVALS.some((interval) => interval === value);
}

const TIER_RANK: Record<PlanTier, number> = {
  free: 0,
  lite: 1,
  full: 2,
};

export function tierSatisfies(tier: PlanTier, required: PlanTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[required];
}

export type PlanFeature = "advanced_filters" | "saved_searches" | "alerts";

const PLAN_FEATURE_MINIMUM_TIER: Record<PlanFeature, PaidPlanTier> = {
  advanced_filters: "lite",
  saved_searches: "lite",
  alerts: "full",
};

export function hasPlanFeature(tier: PlanTier, feature: PlanFeature): boolean {
  return tierSatisfies(tier, PLAN_FEATURE_MINIMUM_TIER[feature]);
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
  tier: PaidPlanTier,
  interval: BillingInterval,
): number {
  return interval === "annual"
    ? PLANS[tier].annualPrice
    : PLANS[tier].monthlyPrice;
}

export function formatMonthlyEquivalent(tier: PaidPlanTier): string {
  const perMonth = PLANS[tier].annualPrice / 12;
  return Number.isInteger(perMonth)
    ? `$${perMonth}`
    : `$${perMonth.toFixed(2)}`;
}
