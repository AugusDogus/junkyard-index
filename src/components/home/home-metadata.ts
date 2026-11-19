import type { Metadata } from "next";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";

export function homeMetadata(yardCount: number): Metadata {
  const count = yardCount.toLocaleString("en-US");
  const title = `Search Junkyard Inventory at ${count} Salvage Yards`;
  const description = `Search live inventory at ${count} salvage yards, including LKQ Pick Your Part, Pick-n-Pull, and Pull-A-Part. Updated daily, with alerts when a match arrives.`;
  return {
    title: { absolute: `${title} | Junkyard Index` },
    description,
    alternates: { canonical: "/" },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      type: "website",
      url: "/",
      title,
      description,
    },
    twitter: { card: "summary", title, description },
  };
}
