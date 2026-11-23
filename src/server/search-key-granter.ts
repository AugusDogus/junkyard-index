import type { HiddenSources } from "~/lib/hidden-source";
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
  /** The sources hidden now; each key leaves them out and names them. */
  hiddenSources: () => Promise<HiddenSources>;
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
    const [tier, hidden] = await Promise.all([
      input.userId ? deps.planTier(input.userId) : ("free" as const),
      deps.hiddenSources(),
    ]);
    if (!deps.parentApiKey) {
      if (!warnedUnsecured) {
        warnedUnsecured = true;
        deps.warn(
          "ALGOLIA_SEARCH_PARENT_API_KEY is not set, so browsers receive the unrestricted ALGOLIA_SEARCH_API_KEY and the free-tier page cap is enforced only in the browser. Search still works. Create a search-only parent key with maxQueriesPerIPPerHour in the Algolia dashboard and set ALGOLIA_SEARCH_PARENT_API_KEY to enforce it.",
        );
      }
      // Only the browser's own filter leaves hidden sources out then.
      return {
        apiKey: deps.serverApiKey,
        expiresInSeconds: SEARCH_KEY_LIFETIME_SECONDS,
        tier,
        hiddenSources: [...hidden.list],
      };
    }
    return SearchApiKey.mint({
      parentApiKey: deps.parentApiKey,
      tier,
      visitor: input.userId
        ? `user:${input.userId}`
        : `ip:${deps.clientIp(input.headers)}`,
      nowMs: input.nowMs,
      hidden,
    });
  };
}

type Granter = ReturnType<typeof create>;

/**
 * The two ways a browser gets a key. A `/search` render uses the cached tier
 * lookup, which sits on every page view. A renewal from `/api/search-key`
 * (every 10 minutes while searching, or when the page's plan changed, such as right after
 * checkout) asks the billing provider directly, since the cache can lag a
 * checkout by up to a minute. When that lookup fails, it mints a free key
 * rather than failing, so search stays up, capped, during an outage.
 */
function pair(
  deps: Omit<Dependencies, "planTier"> & {
    cachedTier: (userId: string) => Promise<PlanTier>;
    directTier: (userId: string) => Promise<PlanTier>;
  },
): { forRender: Granter; forRenewal: Granter } {
  const { cachedTier, directTier, ...shared } = deps;
  return {
    forRender: create({ ...shared, planTier: cachedTier }),
    forRenewal: create({
      ...shared,
      planTier: (userId) => directTier(userId).catch((): PlanTier => "free"),
    }),
  };
}

/** The `/api/search-key` response: a key for this visitor, never cached. */
async function respond(
  grant: Granter,
  input: { userId: string | null; headers: Headers; nowMs: number },
): Promise<Response> {
  return Response.json(await grant(input), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const SearchKeyGranter = { create, pair, respond } as const;
