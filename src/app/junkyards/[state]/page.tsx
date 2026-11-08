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
      <header>
        <h1 className="text-display-s leading-[1.02] font-extrabold">
          Junkyards in {region.name}
        </h1>
        <p className="text-lead text-ink-2 mt-5 max-w-[56ch] leading-[1.45]">
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.plural(yards.length, "yard", "yards")}
          </span>{" "}
          listing{" "}
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.count(vehicles)}
          </span>{" "}
          vehicles.
        </p>
      </header>
      <div className="mt-5">
        <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
      </div>
      <section aria-labelledby="yards-title" className="mt-(--space-2xl)">
        <div className="grid gap-y-3 lg:grid-cols-12 lg:items-baseline lg:gap-x-8">
          <h2
            id="yards-title"
            className="text-section leading-[1.02] font-extrabold lg:col-span-5"
          >
            Yards by size
          </h2>
          <p className="text-lead text-ink-2 leading-[1.45] text-pretty lg:col-span-7">
            Each yard&apos;s page lists every vehicle, newest first, with where
            it sits in the yard when the yard says.
          </p>
        </div>
        <div className="mt-(--space-xl)">
          <YardList yards={ranked} />
        </div>
      </section>
    </PublicPageShell>
  );
}
