import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { YardList } from "~/components/junkyards/YardList";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData } from "~/lib/structured-data";
import { YardPath } from "~/lib/yard-path";
import { getChains, getRoutedYards } from "~/server/yard-inventory";
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
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Junkyards", href: "/junkyards" },
  ];

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
        We track{" "}
        <span className="font-medium tabular-nums">
          {InventoryFormat.count(yards.length)}
        </span>{" "}
        salvage yards in{" "}
        <span className="tabular-nums">
          {InventoryFormat.count(groups.length)}
        </span>{" "}
        states and provinces, listing{" "}
        <span className="font-medium tabular-nums">
          {InventoryFormat.count(vehicles)}
        </span>{" "}
        vehicles. Every yard has a page with its full inventory, checked daily.
      </p>
      <nav aria-label="Chains" className="mt-6">
        <h2 className="mb-2 text-sm font-medium">Chains</h2>
        <ul className="flex flex-wrap gap-1.5">
          {chains.map((chain) => (
            <li key={chain.slug}>
              <Link
                href={chain.href}
                prefetch={false}
                className="hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm"
              >
                {chain.name}
                <span className="text-muted-foreground tabular-nums">
                  {chain.yards.length}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="States and provinces" className="mt-6">
        <h2 className="mb-2 text-sm font-medium">States and provinces</h2>
        <ul className="flex flex-wrap gap-1.5">
          {groups.map(({ region, yards: regionYards }) => (
            <li key={region.slug}>
              <Link
                href={YardPath.regionHref(region)}
                prefetch={false}
                className="hover:bg-muted inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm"
              >
                {region.name}
                <span className="text-muted-foreground tabular-nums">
                  {regionYards.length}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {groups.map(({ region, yards: regionYards }) => (
        <section
          key={region.slug}
          className="mt-10"
          aria-labelledby={`region-${region.slug}`}
        >
          <h2
            id={`region-${region.slug}`}
            className="mb-3 text-lg font-semibold"
          >
            <Link
              href={YardPath.regionHref(region)}
              prefetch={false}
              className="underline-offset-4 hover:underline"
            >
              {region.name}
            </Link>
          </h2>
          <YardList yards={regionYards} />
        </section>
      ))}
    </PublicPageShell>
  );
}
