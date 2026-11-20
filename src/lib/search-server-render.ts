/**
 * Whether the /search server render runs an Algolia search. Every server
 * search spends the shared monthly quota, so only a person asking for
 * specific results gets one. Crawlers and link-preview fetchers, and the
 * default page, render a skeleton and search from the browser instead.
 */
export type SearchServerRender = "search" | "skip";

type SearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

// Crawlers, link unfurlers and command-line fetchers. They rarely run the
// browser search, so the server search was their only cost.
const NON_PERSON_USER_AGENT =
  /bot\b|bot\/|crawl|spider|slurp|facebookexternalhit|embedly|whatsapp|preview|curl\/|wget\/|python-requests|go-http-client|axios\/|node-fetch|undici/i;

// Params that never change the search: campaign tags and checkout return.
const NON_SEARCH_PARAM = /^(utm_[a-z_]+|gclid|fbclid|msclkid|subscription)$/;

export const SearchServerRender = {
  isNonPersonUserAgent(userAgent: string | null): boolean {
    return userAgent === null || NON_PERSON_USER_AGENT.test(userAgent);
  },

  /** No param asks for anything but the default results. */
  isDefaultSearch(params: SearchParams): boolean {
    return Object.entries(params).every(
      ([key, value]) => value === undefined || NON_SEARCH_PARAM.test(key),
    );
  },

  decide(input: {
    userAgent: string | null;
    params: SearchParams;
  }): SearchServerRender {
    return SearchServerRender.isNonPersonUserAgent(input.userAgent) ||
      SearchServerRender.isDefaultSearch(input.params)
      ? "skip"
      : "search";
  },
} as const;
