import type { PaidPlanTier, PlanTier } from "~/lib/plans";

export type BillingAccountOverview =
  | { kind: "none" }
  | { kind: "active"; tier: PaidPlanTier }
  | { kind: "needs_attention" }
  | { kind: "unrecognized" };

export type BillingAccountState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | Exclude<BillingAccountOverview, { kind: "unrecognized" }>;

export function normalizeBillingAccount(input: {
  overview: BillingAccountOverview | undefined;
  isLoading: boolean;
  isError: boolean;
}): BillingAccountState {
  if (input.isLoading) return { kind: "loading" };
  if (
    input.isError ||
    !input.overview ||
    input.overview.kind === "unrecognized"
  ) {
    return { kind: "unavailable" };
  }
  return input.overview;
}

export function billingAccountTier(
  state: BillingAccountState,
): PlanTier | null {
  switch (state.kind) {
    case "active":
      return state.tier;
    case "none":
    case "needs_attention":
      return "free";
    case "loading":
    case "unavailable":
      return null;
  }
}
