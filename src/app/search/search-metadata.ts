import type { Metadata } from "next";
import { sitePageUrl } from "~/lib/site-metadata";

type SearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

/**
 * /search metadata. Each parameterized URL is one search, not a page of its
 * own: crawlers may fetch it and follow its links, but index only the
 * canonical /search.
 */
export function searchPageMetadata(params: SearchParams): Metadata {
  return {
    title: "Search Salvage Yard Inventory",
    description:
      "Search donor vehicles across salvage yard networks, compare results by yard and distance, and create saved searches for ongoing inventory tracking.",
    ...sitePageUrl("/search"),
    ...(Object.keys(params).length > 0 && {
      robots: { index: false, follow: true },
    }),
  };
}
