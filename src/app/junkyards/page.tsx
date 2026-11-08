import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FreshnessBadge } from "~/components/inventory/FreshnessBadge";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { YardList } from "~/components/junkyards/YardList";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData } from "~/lib/structured-data";
import { YardPath } from "~/lib/yard-path";
import {
  getChains,
  getRoutedYards,
  inventoryFreshness,
} from "~/server/yard-inventory";
import { InventoryFormat } from "~/lib/inventory-format";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;

const TITLE = "Junkyards with Live Inventory by State";
const DESCRIPTION =
  "Every salvage yard we track, by state, with a live vehicle count and a full inventory page for each yard. Listings are checked daily.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/junkyards" },
  openGraph: {
    ...SITE_OPEN_GRAPH,
    type: "website",
    url: "/junkyards",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export default async function JunkyardsPage() {
  const [yards, chains] = await Promise.all([getRoutedYards(), getChains()]);
  const groups = YardPath.byRegion(yards);
  const vehicles = yards.reduce((sum, yard) => sum + yard.vehicleCount, 0);
  const freshness = await inventoryFreshness(yards);
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Junkyards", href: "/junkyards" },
  ];
  const regionRows = groups
    .map(({ region, yards: regionYards }) => ({
      region,
      yards: regionYards,
      vehicles: regionYards.reduce((sum, yard) => sum + yard.vehicleCount, 0),
    }))
    .sort((a, b) => b.vehicles - a.vehicles);

  return (
    <PublicPageShell>
      <JsonLd
        nodes={[StructuredData.breadcrumbs(env.NEXT_PUBLIC_APP_URL, crumbs)]}
      />
      <Breadcrumbs crumbs={crumbs} />
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        Junkyards with live inventory
      </h1>
      <p className="mt-3 text-base text-pretty">
        <span className="font-semibold tabular-nums">
          {InventoryFormat.count(yards.length)}
        </span>{" "}
        self-service yards in {InventoryFormat.count(groups.length)} states and
        provinces, listing{" "}
        <span className="font-semibold tabular-nums">
          {InventoryFormat.count(vehicles)}
        </span>{" "}
        vehicles. Pick your state, then a yard, to see everything it has.
      </p>
      <div className="mt-2">
        <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
      </div>

      <section aria-labelledby="states-title" className="mt-8">
        <h2 id="states-title" className="text-lg font-semibold">
          By state
        </h2>
        <ul className="mt-3 grid gap-x-8 border-t sm:grid-cols-2">
          {regionRows.map(({ region, yards: regionYards, vehicles: count }) => (
            <li key={region.slug} className="border-b">
              <Link
                href={YardPath.regionHref(region)}
                prefetch={false}
                className="hover:bg-muted/60 flex items-baseline justify-between gap-4 px-1 py-2.5"
              >
                <span className="text-sm font-medium">{region.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {InventoryFormat.plural(regionYards.length, "yard", "yards")}{" "}
                  · {InventoryFormat.count(count)} vehicles
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="chains-title" className="mt-10">
        <h2 id="chains-title" className="text-lg font-semibold">
          By chain
        </h2>
        <ul className="mt-3 grid gap-x-8 border-t sm:grid-cols-2">
          {chains.map((chain) => (
            <li key={chain.slug} className="border-b">
              <Link
                href={chain.href}
                prefetch={false}
                className="hover:bg-muted/60 flex items-baseline justify-between gap-4 px-1 py-2.5"
              >
                <span className="text-sm font-medium">{chain.name}</span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {InventoryFormat.plural(chain.yards.length, "yard", "yards")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="all-title" className="mt-10">
        <h2 id="all-title" className="text-lg font-semibold">
          Every yard
        </h2>
        <div className="mt-3 divide-y border-y">
          {groups.map(({ region, yards: regionYards }) => (
            <details key={region.slug} className="group">
              <summary className="hover:bg-muted/60 flex cursor-pointer list-none items-center justify-between gap-4 px-1 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-1.5">
                  <ChevronRight
                    className="text-muted-foreground size-4 transition-transform group-open:rotate-90"
                    aria-hidden="true"
                  />
                  {region.name}
                </span>
                <span className="text-muted-foreground text-xs font-normal tabular-nums">
                  {InventoryFormat.plural(regionYards.length, "yard", "yards")}
                </span>
              </summary>
              <div className="pb-3">
                <YardList yards={regionYards} />
              </div>
            </details>
          ))}
        </div>
      </section>
    </PublicPageShell>
  );
}
