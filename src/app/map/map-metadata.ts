import type { Metadata } from "next";
import { SITE_OPEN_GRAPH, SITE_TWITTER } from "~/lib/site-metadata";

const TITLE = "Salvage Yard Map";
const DESCRIPTION =
  "Every salvage yard Junkyard Index covers, on one map. Pick a yard for its live inventory, website and directions.";

export const mapMetadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/map" },
  openGraph: {
    ...SITE_OPEN_GRAPH,
    type: "website",
    url: "/map",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { ...SITE_TWITTER, title: TITLE, description: DESCRIPTION },
};
