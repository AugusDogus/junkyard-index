import type { Metadata } from "next";
import { SITE_OPEN_GRAPH, SITE_TWITTER } from "~/lib/site-metadata";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://junkyardindex.com";

export const rootMetadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Junkyard Index",
    template: "%s | Junkyard Index",
  },
  description:
    "Search salvage yard inventory across major yard networks, save searches, and get alerts when new donor vehicles arrive.",
  keywords: [
    "junkyard",
    "salvage yard",
    "auto parts",
    "used car parts",
    "pick your part",
    "LKQ",
    "Row52",
    "self-service auto parts",
    "car parts search",
    "junkyard inventory",
  ],
  authors: [{ name: "Junkyard Index" }],
  creator: "Junkyard Index",
  // Only site-wide facts. A page's URL, title, and description are its own;
  // pages that want a link preview set them, so none inherits the homepage's.
  openGraph: { ...SITE_OPEN_GRAPH, type: "website" },
  twitter: SITE_TWITTER,
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: [{ rel: "icon", url: "/favicon.svg" }],
};

/**
 * Every 404. Next already sends <meta name="robots" content="noindex"> with
 * it, so this clears the layout's "index, follow" rather than adding a
 * second robots tag.
 */
export const notFoundMetadata: Metadata = {
  title: "Page not found",
  robots: null,
};
