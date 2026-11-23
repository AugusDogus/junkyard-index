import { createHash, createHmac } from "node:crypto";
import { ALGOLIA_SEARCH_INDEX_NAMES, SEARCH_CONFIG } from "~/lib/constants";
import { HiddenSources } from "~/lib/hidden-source";
import { isPaidPlanTier, type PlanTier } from "~/lib/plans";
import type { SearchKeyGrant } from "~/lib/search-key-grant";

/**
 * Secured keys expire after 15 minutes; browsers fetch the next one 5
 * minutes before, when they next search. Each key embeds the hidden-source
 * filter, so this bounds how long an open tab can still read a source hidden
 * from /admin (docs/runbooks/hide-source.md). Minting is local and costs no
 * Algolia quota.
 */
export const SEARCH_KEY_LIFETIME_SECONDS = 15 * 60;

/**
 * The restrictions a browser's secured key carries. Algolia applies embedded
 * search parameters to every request and the query cannot override them, so
 * free keys (visitors and free accounts) can only ever read the first 24
 * results, whether a request pages by page/hitsPerPage or offset/length.
 * Every key:
 * - reads only this deployment's search indices (the env namespace);
 * - expires after 15 minutes;
 * - carries a per-visitor `userToken`, so the parent key's
 *   `maxQueriesPerIPPerHour` is counted per visitor even behind shared IPs;
 * - filters out the sources hidden when it was minted, which Algolia ANDs
 *   with the request's own filters, so a hand-made request cannot read them
 *   either.
 *
 * Secured keys cannot forbid filters. Algolia applies embedded `filters` in
 * addition to the query's own, so a free key cannot stop a request from
 * adding state, yard or field filters (the Lite features); the browser hides
 * them, but a hand-made request can still send them. If that gap matters, the
 * fallback is an `/api/search` proxy that validates each request.
 */
function restrictions(input: {
  tier: PlanTier;
  visitor: string;
  nowMs: number;
  hidden: HiddenSources;
}): Record<string, string | number | readonly string[]> {
  const hiddenFilter = HiddenSources.algoliaFilter(input.hidden);
  return {
    restrictIndices: ALGOLIA_SEARCH_INDEX_NAMES,
    validUntil: validUntil(input.nowMs),
    userToken: createHash("sha256")
      .update(input.visitor)
      .digest("hex")
      .slice(0, 32),
    ...(hiddenFilter !== undefined && { filters: hiddenFilter }),
    // Search parameters sit beside the other restrictions in the signed
    // query string, as Algolia's generateSecuredApiKey writes them. Offset
    // pagination is an alternative to page/hitsPerPage, so free keys pin
    // both forms; otherwise `offset: 24` would read past the first page.
    ...(isPaidPlanTier(input.tier)
      ? {}
      : {
          hitsPerPage: SEARCH_CONFIG.FREE_VISIBLE_RESULTS_LIMIT,
          page: 0,
          offset: 0,
          length: SEARCH_CONFIG.FREE_VISIBLE_RESULTS_LIMIT,
        }),
  };
}

function validUntil(nowMs: number): number {
  return Math.floor(nowMs / 1000) + SEARCH_KEY_LIFETIME_SECONDS;
}

/**
 * Algolia's secured key format: base64 of the hex HMAC-SHA256 of the
 * restrictions' query string (keys sorted, arrays comma-joined), followed by
 * that query string. The tests check it against the SDK's own helper, whose
 * Node-only typing this project's browser-first resolution cannot see.
 */
function sign(
  parentApiKey: string,
  restricted: Record<string, string | number | readonly string[]>,
): string {
  const query = Object.keys(restricted)
    .sort()
    .map((key) => {
      const value = restricted[key];
      const text =
        typeof value === "string" || typeof value === "number"
          ? String(value)
          : (value ?? []).join(",");
      return `${key}=${encodeURIComponent(text).replace(/\+/g, "%20")}`;
    })
    .join("&");
  const signature = createHmac("sha256", parentApiKey)
    .update(query)
    .digest("hex");
  return Buffer.from(signature + query).toString("base64");
}

/**
 * Mints a secured key from `parentApiKey`. This is a local HMAC: it sends no
 * request to Algolia and costs no quota.
 */
function mint(input: {
  parentApiKey: string;
  tier: PlanTier;
  visitor: string;
  nowMs: number;
  hidden: HiddenSources;
}): SearchKeyGrant {
  return {
    apiKey: sign(input.parentApiKey, restrictions(input)),
    expiresInSeconds: SEARCH_KEY_LIFETIME_SECONDS,
    tier: input.tier,
    hiddenSources: [...input.hidden.list],
  };
}

export const SearchApiKey = { restrictions, mint } as const;
