import type { MetadataRoute } from "next";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://junkyardindex.com";

/**
 * Site pages. They carry no lastmod: a build time would claim changes that
 * didn't happen. Region and yard pages are in /junkyards/sitemap.xml, chain
 * hubs in /chains/sitemap.xml, make and model pages in /cars/sitemap.xml.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: APP_URL,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${APP_URL}/junkyards`,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${APP_URL}/cars`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${APP_URL}/chains`,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${APP_URL}/search`,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${APP_URL}/pricing`,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${APP_URL}/privacy`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${APP_URL}/terms`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${APP_URL}/contact`,
      changeFrequency: "monthly",
      priority: 0.3,
    },
  ];
}
