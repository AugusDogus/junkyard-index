import { SearchArea } from "./search-area";
import { SearchRadius } from "./search-radius";

/**
 * Whether /search runs an Algolia search, and where. Every search spends the
 * shared monthly quota, so only a person asking for specific results gets a
 * server search. The default page and nearby searches whose origin only the
 * browser knows `skip` it: they render a skeleton and search from the
 * browser. A `crawler` (crawlers, link-preview fetchers and other non-person
 * clients) gets the same skeleton but never searches at all, not even from a
 * rendering crawler's browser.
 */
export type SearchServerRender = "search" | "skip" | "crawler";

type SearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

// Crawlers, link unfurlers, monitors, headless browsers and command-line
// fetchers. Rendering crawlers such as Googlebot run the page's scripts, so
// a browser search would spend the quota too. The lookbehinds keep Cubot
// phones ("CUBOT X30", "CUBOT_X50", "CUBOT/P30") on the search.
const NON_PERSON_USER_AGENT =
  /(?<!cu)bot\b|(?<!cu)bot[/_]|crawl|spider|slurp|facebookexternalhit|embedly|whatsapp|preview|inspectiontool|lighthouse|headless|curl\/|wget\/|python-|scrapy|okhttp|java\/|go-http-client|axios\/|node-fetch|undici/i;

// Params that never change the search: campaign tags and checkout return.
const NON_SEARCH_PARAM = /^(utm_[a-z_]+|gclid|fbclid|msclkid|subscription)$/;

function urlParams(params: SearchParams): URLSearchParams {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const item of [value].flat())
      if (item !== undefined) url.append(key, item);
  return url;
}

export const SearchServerRender = {
  isNonPersonUserAgent(userAgent: string | null): boolean {
    return !userAgent?.trim() || NON_PERSON_USER_AGENT.test(userAgent);
  },

  /**
   * A distance sort or radius whose origin is not in the URL. Its origin is
   * the browser's saved location or the account's, which the server render
   * does not see, so the browser would search again once it loads them.
   */
  isNearbyWithoutOrigin(params: SearchParams): boolean {
    const url = urlParams(params);
    const nearby =
      url.get("sort") === "distance" ||
      SearchRadius.parse(url.get("radius")) !== null;
    return nearby && SearchArea.fromUrl(url) === undefined;
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
    if (SearchServerRender.isNonPersonUserAgent(input.userAgent))
      return "crawler";
    return SearchServerRender.isDefaultSearch(input.params) ||
      SearchServerRender.isNearbyWithoutOrigin(input.params)
      ? "skip"
      : "search";
  },
} as const;
