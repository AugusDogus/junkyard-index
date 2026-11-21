import "server-only";

import { env } from "~/env";
import { getClientIp } from "~/lib/rate-limit";
import { getPlanTier } from "~/server/billing/user-plan";
import { SearchKeyGranter } from "~/server/search-key-granter";

/** The key this visitor's browser searches with, minted for their plan. */
export const grantSearchKey = SearchKeyGranter.create({
  parentApiKey: env.ALGOLIA_SEARCH_PARENT_API_KEY,
  serverApiKey: env.ALGOLIA_SEARCH_API_KEY,
  planTier: getPlanTier,
  clientIp: getClientIp,
  warn: (message) => console.warn(message),
});
