import "server-only";

import { env } from "~/env";
import { getClientIp } from "~/lib/rate-limit";
import {
  getAuthoritativePlanTier,
  getPlanTier,
} from "~/server/billing/user-plan";
import { SearchKeyGranter } from "~/server/search-key-granter";

/**
 * `forRender` serves `/search` renders from the tier cache; `forRenewal`
 * serves `/api/search-key` from Polar directly (see `SearchKeyGranter.pair`).
 */
export const searchKeyGrants = SearchKeyGranter.pair({
  parentApiKey: env.ALGOLIA_SEARCH_PARENT_API_KEY,
  serverApiKey: env.ALGOLIA_SEARCH_API_KEY,
  cachedTier: getPlanTier,
  directTier: getAuthoritativePlanTier,
  clientIp: getClientIp,
  warn: (message) => console.warn(message),
});
