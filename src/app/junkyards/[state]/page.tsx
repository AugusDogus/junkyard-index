import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { YardList } from "~/components/junkyards/YardList";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData } from "~/lib/structured-data";
import { YardName } from "~/lib/yard-name";
import { YardPath } from "~/lib/yard-path";
import { FreshnessBadge } from "~/components/inventory/FreshnessBadge";
import { findRegionYards, inventoryFreshness } from "~/server/yard-inventory";
import { InventoryFormat } from "~/lib/inventory-format";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { state: string };

export function generateStaticParams(): Params[] {
  return [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const found = await findRegionYards((await params).state);
  if (!found) return {};
  const { region, yards } = found;
  const vehicles = yards.reduce((sum, yard) => sum + yard.vehicleCount, 0);
  const title = `Junkyards in ${region.name} with Live Inventory`;
  const description = `${InventoryFormat.count(yards.length)} salvage ${yards.length === 1 ? "yard" : "yards"} in ${region.name} with ${InventoryFormat.count(vehicles)} vehicles listed. See each yard's full inventory, checked daily.`;
  const url = YardPath.regionHref(region);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...SITE_OPEN_GRAPH, type: "website", url, title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function RegionPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const found = await findRegionYards((await params).state);
  if (!found) notFound();
  const { region, yards } = found;
  const vehicles = yards.reduce((sum, yard) => sum + yard.vehicleCount, 0);
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Junkyards", href: "/junkyards" },
    { name: region.name, href: YardPath.regionHref(region) },
  ];
  // Biggest first: the yards most likely to have what a visitor needs.
  const ranked = [...yards].sort((a, b) => b.vehicleCount - a.vehicleCount);
  const freshness = await inventoryFreshness(yards);

  return (
    <PublicPageShell>
      <JsonLd
        nodes={[
          StructuredData.breadcrumbs(env.NEXT_PUBLIC_APP_URL, crumbs),
          {
            "@type": "ItemList",
            name: `Junkyards in ${region.name}`,
            numberOfItems: yards.length,
            itemListElement: yards.map((yard, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: new URL(yard.path.href, env.NEXT_PUBLIC_APP_URL).toString(),
              name: YardName.headline(yard.name, yard.operator),
            })),
          },
        ]}
      />
      <Breadcrumbs crumbs={crumbs} />
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        Junkyards in {region.name}
      </h1>
      <p className="mt-3 text-base text-pretty">
        <span className="font-semibold tabular-nums">
          {InventoryFormat.plural(yards.length, "yard", "yards")}
        </span>{" "}
        listing{" "}
        <span className="font-semibold tabular-nums">
          {InventoryFormat.count(vehicles)}
        </span>{" "}
        vehicles. Each yard&apos;s page lists every vehicle, newest first, with
        where it sits in the yard when the yard says.
      </p>
      <div className="mt-2">
        <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
      </div>
      <section aria-labelledby="yards-title" className="mt-8">
        <h2 id="yards-title" className="text-lg font-semibold">
          Yards by size
        </h2>
        <div className="mt-3">
          <YardList yards={ranked} />
        </div>
      </section>
    </PublicPageShell>
  );
}
