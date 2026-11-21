import type { PlanTier } from "~/lib/plans";
import type { SearchKeyGrant } from "~/lib/search-key-grant";
import {
  SEARCH_KEY_LIFETIME_SECONDS,
  SearchApiKey,
} from "~/server/search-api-key";

type Dependencies = {
  /** Parent of secured keys; unset until the owner creates it. */
  parentApiKey: string | undefined;
  /** The server's own search key, sent unrestricted without a parent. */
  serverApiKey: string;
  /** Resolves a signed-in account's tier, failing closed to free. */
  planTier: (userId: string) => Promise<PlanTier>;
  clientIp: (headers: Headers) => string;
  warn: (message: string) => void;
};

/**
 * Decides the key a visitor's browser searches with. The tier is resolved on
 * the server; visitors are free. Accounts are rate limited per account and
 * visitors per IP, through the key's hashed `userToken`.
 */
function create(deps: Dependencies) {
  let warnedUnsecured = false;
  return async function grant(input: {
    userId: string | null;
    headers: Headers;
    nowMs: number;
  }): Promise<SearchKeyGrant> {
    const tier: PlanTier = input.userId
      ? await deps.planTier(input.userId)
      : "free";
    if (!deps.parentApiKey) {
      if (!warnedUnsecured) {
        warnedUnsecured = true;
        deps.warn(
          "ALGOLIA_SEARCH_PARENT_API_KEY is not set, so browsers receive the unrestricted ALGOLIA_SEARCH_API_KEY and the free-tier page cap is enforced only in the browser. Search still works. Create a search-only parent key with maxQueriesPerIPPerHour in the Algolia dashboard and set ALGOLIA_SEARCH_PARENT_API_KEY to enforce it.",
        );
      }
      return {
        apiKey: deps.serverApiKey,
        validUntil:
          Math.floor(input.nowMs / 1000) + SEARCH_KEY_LIFETIME_SECONDS,
        tier,
      };
    }
    return SearchApiKey.mint({
      parentApiKey: deps.parentApiKey,
      tier,
      visitor: input.userId
        ? `user:${input.userId}`
        : `ip:${deps.clientIp(input.headers)}`,
      nowMs: input.nowMs,
    });
  };
}

export const SearchKeyGranter = { create } as const;
