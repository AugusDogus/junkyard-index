import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://junkyardindex.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Auth pages and parameterized /search stay crawlable so crawlers
        // can see their noindex. Crawler renders of /search skip the Algolia
        // search (src/lib/search-server-render.ts), so crawling is free.
        disallow: ["/api/"],
      },
    ],
    sitemap: [
      `${APP_URL}/sitemap.xml`,
      `${APP_URL}/junkyards/sitemap.xml`,
      `${APP_URL}/chains/sitemap.xml`,
      `${APP_URL}/cars/sitemap.xml`,
    ],
  };
}
