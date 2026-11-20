import "server-only";

import { env } from "~/env";
import type { PlanTier } from "~/lib/plans";
import { getClientIp } from "~/lib/rate-limit";
import type { SearchKeyGrant } from "~/lib/search-key-grant";
import { getPlanTier } from "~/server/billing/user-plan";
import {
  SEARCH_KEY_LIFETIME_SECONDS,
  SearchApiKey,
} from "~/server/search-api-key";

let warnedUnsecured = false;

/**
 * The key this visitor's browser searches with. The tier is resolved here,
 * on the server, and an unknown plan resolves to free (see `getPlanTier`).
 * Signed-in accounts are rate limited per account, visitors per IP.
 */
export async function grantSearchKey(input: {
  userId: string | null;
  headers: Headers;
  nowMs: number;
}): Promise<SearchKeyGrant> {
  const tier: PlanTier = input.userId
    ? await getPlanTier(input.userId)
    : "free";
  const parentApiKey = env.ALGOLIA_SEARCH_PARENT_API_KEY;
  if (!parentApiKey) {
    if (!warnedUnsecured) {
      warnedUnsecured = true;
      console.warn(
        "ALGOLIA_SEARCH_PARENT_API_KEY is not set, so browsers receive the unrestricted ALGOLIA_SEARCH_API_KEY and the free-tier page cap is enforced only in the browser. Search still works. Create a search-only parent key with maxQueriesPerIPPerHour in the Algolia dashboard and set ALGOLIA_SEARCH_PARENT_API_KEY to enforce it.",
      );
    }
    return {
      apiKey: env.ALGOLIA_SEARCH_API_KEY,
      validUntil: Math.floor(input.nowMs / 1000) + SEARCH_KEY_LIFETIME_SECONDS,
      tier,
    };
  }
  return SearchApiKey.mint({
    parentApiKey,
    tier,
    visitor: input.userId
      ? `user:${input.userId}`
      : `ip:${getClientIp(input.headers)}`,
    nowMs: input.nowMs,
  });
}
