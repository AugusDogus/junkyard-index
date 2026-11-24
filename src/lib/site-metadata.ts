import type { Metadata } from "next";

/** The default link-preview image, served by src/app/opengraph-image.tsx. */
export const SITE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "Junkyard Index: search salvage yard inventory across yard networks",
} as const;

/**
 * Open Graph fields every page shares. Next replaces a parent's `openGraph`
 * wholesale, so pages that set their own spread this in. That includes the
 * image: a file-based opengraph-image reaches only pages that set none.
 */
export const SITE_OPEN_GRAPH = {
  siteName: "Junkyard Index",
  locale: "en_US",
  // Metadata's image list is mutable, so this one can't be readonly.
  images: [SITE_IMAGE],
};

/**
 * Twitter fields every page shares. Next fills the card's title,
 * description, and image from Open Graph when a page leaves them out.
 */
export const SITE_TWITTER = { card: "summary_large_image" } as const;

/** Canonical and link-preview URL for a page that lives at one fixed path. */
export function sitePageUrl(
  path: string,
): Pick<Metadata, "alternates" | "openGraph"> {
  return {
    alternates: { canonical: path },
    openGraph: { ...SITE_OPEN_GRAPH, type: "website", url: path },
  };
}
