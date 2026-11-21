import "server-only";

import { env } from "~/env";
import type { PlanTier } from "~/lib/plans";
import { getClientIp } from "~/lib/rate-limit";
import {
  getAuthoritativePlanTier,
  getPlanTier,
} from "~/server/billing/user-plan";
import { SearchKeyGranter } from "~/server/search-key-granter";

function granter(planTier: (userId: string) => Promise<PlanTier>) {
  return SearchKeyGranter.create({
    parentApiKey: env.ALGOLIA_SEARCH_PARENT_API_KEY,
    serverApiKey: env.ALGOLIA_SEARCH_API_KEY,
    planTier,
    clientIp: getClientIp,
    warn: (message) => console.warn(message),
  });
}

/**
 * The key a `/search` render gives the browser. It uses the short-lived tier
 * cache, which sits on every page view and can lag a plan change by up to a
 * minute; the browser replaces a key that disagrees with the plan it shows.
 */
export const grantSearchKey = granter(getPlanTier);

/**
 * A replacement key for `/api/search-key`, asked for when a key nears expiry
 * or the page's plan changed (such as right after checkout). It asks Polar
 * directly, so it sees the plan the page saw, and refreshes the tier cache.
 * A failed lookup is logged by the plan service and mints a free key.
 */
export const grantRenewedSearchKey = granter((userId) =>
  getAuthoritativePlanTier(userId).catch((): PlanTier => "free"),
);
