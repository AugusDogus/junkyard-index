import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://junkyardindex.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Auth pages and parameterized /search stay crawlable so crawlers
        // can see their noindex. /search never searches Algolia for a
        // crawler, on the server or in its browser: it renders a static page
        // instead (src/lib/search-server-render.ts).
        disallow: ["/api/"],
      },
    ],
    sitemap: [
      `${APP_URL}/sitemap.xml`,
      `${APP_URL}/junkyards/sitemap.xml`,
      `${APP_URL}/chains/sitemap.xml`,
      `${APP_URL}/cars/sitemap.xml`,
      // Yard-make pages, kept out of the hub sitemaps above.
      `${APP_URL}/junkyards/sitemap-makes.xml`,
    ],
  };
}
