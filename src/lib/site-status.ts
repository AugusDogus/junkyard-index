import { z } from "zod";

/**
 * Whether the site itself is up, from the Better Stack status page. The page
 * also lists every provider's ingestion heartbeat, and its aggregate state
 * turns "degraded" whenever one yard's crawl is late. Visitors can still
 * search then, so the public badge reads only the page's first section,
 * which holds the site's own monitors.
 *
 * This depends on the status page's layout. As of Nov 2026, section 0 is
 * "Current status by service" (the site's monitor) and section 1 is
 * "Providers" (one resource per ingestion source). If the provider section
 * moves first, late crawls mark the badge again; if the first section is
 * emptied, the badge reads "unknown" and shows plain "System status" even
 * during an outage. Keep the site's monitors in the top section.
 */
export type SiteStatus = "operational" | "degraded" | "downtime" | "unknown";

const pageSchema = z.object({ included: z.array(z.unknown()) });
const sectionSchema = z.object({
  type: z.literal("status_page_section"),
  id: z.string(),
  attributes: z.object({ position: z.number() }),
});
const resourceSchema = z.object({
  type: z.literal("status_page_resource"),
  attributes: z.object({
    status_page_section_id: z.number(),
    status: z.string(),
  }),
});

function parse(json: unknown): SiteStatus {
  const page = pageSchema.safeParse(json);
  if (!page.success) return "unknown";
  // Status updates, reports, and anything else the page includes are skipped.
  const sections = page.data.included.flatMap((item) => {
    const section = sectionSchema.safeParse(item);
    return section.success ? [section.data] : [];
  });
  const resources = page.data.included.flatMap((item) => {
    const resource = resourceSchema.safeParse(item);
    return resource.success ? [resource.data.attributes] : [];
  });
  const first = sections.reduce<(typeof sections)[number] | null>(
    (best, section) =>
      !best || section.attributes.position < best.attributes.position
        ? section
        : best,
    null,
  );
  const site = resources
    .filter(
      (resource) =>
        first !== null && String(resource.status_page_section_id) === first.id,
    )
    .map((resource) => resource.status);
  if (site.includes("downtime")) return "downtime";
  if (site.includes("degraded")) return "degraded";
  if (site.length > 0 && site.every((status) => status === "operational"))
    return "operational";
  return "unknown";
}

export const SiteStatus = { parse } as const;
