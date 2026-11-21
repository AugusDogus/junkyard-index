import { SEARCH_CONFIG } from "~/lib/constants";
import type { PlanAccessState } from "~/lib/plan-access";
import { isPaidPlanTier, type PlanTier } from "~/lib/plans";

/**
 * Why a search shows only its first page. Each reason has its own prompt:
 * visitors can sign up, free accounts can upgrade, and an account whose plan
 * is not known yet is told to wait or refresh rather than to pay again.
 */
export type SearchResultCapReason =
  | "visitor"
  | "free_plan"
  | "plan_pending"
  | "plan_unconfirmed";

/**
 * How much of a search the page may fetch and show. Paid plans browse every
 * page. Everyone else gets the first page only, including signed-in accounts
 * whose plan has not resolved, so an unknown plan never fetches more than a
 * free one.
 */
export type SearchResultCap =
  | { kind: "uncapped" }
  | { kind: "capped"; limit: number; reason: SearchResultCapReason };

function capped(reason: SearchResultCapReason): SearchResultCap {
  return {
    kind: "capped",
    limit: SEARCH_CONFIG.FREE_VISIBLE_RESULTS_LIMIT,
    reason,
  };
}

function resolve(input: {
  isLoggedIn: boolean;
  planAccess: PlanAccessState;
  /**
   * The tier of the key the browser searches with, or null while one is
   * fetched. A free key returns only the first page whatever the page asks,
   * so paging past it would fetch the same results again.
   */
  searchKeyTier: PlanTier | null;
}): SearchResultCap {
  if (!input.isLoggedIn) return capped("visitor");
  switch (input.planAccess.kind) {
    case "loading":
      return capped("plan_pending");
    case "unavailable":
      return capped("plan_unconfirmed");
    case "resolved":
      if (input.planAccess.tier === "free") return capped("free_plan");
      if (input.searchKeyTier === null) return capped("plan_pending");
      // The server could not confirm the plan the browser sees.
      return isPaidPlanTier(input.searchKeyTier)
        ? { kind: "uncapped" }
        : capped("plan_unconfirmed");
  }
}

/**
 * Whether the cap is the plan's limit, so the page may offer an upgrade and
 * count a `result_cap_reached`. A pending or unconfirmed plan is capped only
 * until it resolves, and may already be paid.
 */
function isPlanLimit(cap: SearchResultCap): boolean {
  return (
    cap.kind === "capped" &&
    (cap.reason === "visitor" || cap.reason === "free_plan")
  );
}

export const SearchResultCap = { resolve, isPlanLimit } as const;
