import { expect, test } from "bun:test";
import { rootMetadata as metadata } from "~/app/root-metadata";
import { yardPageMetadata } from "./yard-page-metadata";
import { Region } from "./region";
import {
  SITE_IMAGE,
  SITE_OPEN_GRAPH,
  SITE_TWITTER,
  sitePageUrl,
} from "./site-metadata";

test("link previews default to the site image as a large card", () => {
  expect(SITE_IMAGE).toMatchObject({
    url: "/opengraph-image",
    width: 1200,
    height: 630,
  });
  expect(SITE_OPEN_GRAPH.images).toEqual([SITE_IMAGE]);
  expect(SITE_TWITTER.card).toBe("summary_large_image");
  expect(metadata.openGraph?.images).toEqual([SITE_IMAGE]);
  expect(metadata.twitter).toMatchObject({ card: "summary_large_image" });
});

test("a page that sets its own preview keeps the site image", () => {
  const region = Region.fromAbbr("PA");
  if (!region) throw new Error("Expected Pennsylvania");
  const page = yardPageMetadata(
    {
      name: "Weber Brothers Auto",
      operator: null,
      city: "Annville",
      state: "PA",
      path: { region, slug: "weber", href: "/junkyards/pennsylvania/weber" },
    },
    10,
    null,
    1,
  );
  expect(page.openGraph?.images).toEqual([SITE_IMAGE]);
  expect(page.twitter).toMatchObject({ card: "summary_large_image" });
});

test("a static page's canonical and preview URL are its own path", () => {
  const page = sitePageUrl("/pricing");
  expect(page.alternates?.canonical).toBe("/pricing");
  expect(page.openGraph).toMatchObject({
    url: "/pricing",
    siteName: "Junkyard Index",
    images: [SITE_IMAGE],
  });
});
