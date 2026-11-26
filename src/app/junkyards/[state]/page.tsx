import Link from "next/link";
import { buildSearchUrl } from "~/lib/search-utils";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { YardList } from "~/components/junkyards/YardList";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { SITE_OPEN_GRAPH, SITE_TWITTER } from "~/lib/site-metadata";
import { StructuredData } from "~/lib/structured-data";
import { YardName } from "~/lib/yard-name";
import { YardPath } from "~/lib/yard-path";
import { FreshnessBadge } from "~/components/inventory/FreshnessBadge";
import {
  findRegionYards,
  getInventoryCheckDates,
  getRegionNewCount,
  getRoutedYards,
  inventoryFreshness,
} from "~/server/yard-inventory";
import { InventoryFormat } from "~/lib/inventory-format";

// Rebuilt after each daily ingestion pass, which invalidates the inventory
// cache tag. This is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { state: string };

/**
 * Every region with yards renders at build. Each reads only cached
 * summaries: the yard directory, source freshness, and new arrivals per state.
 */
export async function generateStaticParams(): Promise<Params[]> {
  return YardPath.byRegion(await getRoutedYards()).map(({ region }) => ({
    state: region.slug,
  }));
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
    twitter: { ...SITE_TWITTER, title, description },
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
  const [freshness, newCount, checkDates] = await Promise.all([
    inventoryFreshness(yards),
    getRegionNewCount(region.abbr),
    getInventoryCheckDates(),
  ]);

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
        <h1 className="text-display-s leading-[1.02] font-medium">
          Junkyards in {region.name}
        </h1>
        <p className="text-lead text-ink-2 mt-5 max-w-[56ch] leading-[1.45]">
          <span className="text-ink font-medium tabular-nums">
            {InventoryFormat.plural(yards.length, "yard", "yards")}
          </span>{" "}
          listing{" "}
          <span className="text-ink font-medium tabular-nums">
            {InventoryFormat.count(vehicles)}
          </span>{" "}
          vehicles.
        </p>
      </header>
      <p className="mt-4">
        <Link
          className="text-signal inline-flex min-h-11 items-center font-medium tabular-nums underline underline-offset-4"
          href={buildSearchUrl("", {
            arrivalWindow: "7d",
            states: [region.name],
            yardTypes: [],
          })}
        >
          {InventoryFormat.count(newCount)} new this week
        </Link>
      </p>
      <div className="mt-5">
        <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
      </div>
      <section aria-labelledby="yards-title" className="mt-(--space-2xl)">
        <div className="grid gap-y-3 lg:grid-cols-12 lg:items-baseline lg:gap-x-8">
          <h2
            id="yards-title"
            className="text-section leading-[1.02] font-medium lg:col-span-5"
          >
            Yards by size
          </h2>
          <p className="text-lead text-ink-2 leading-[1.45] text-pretty lg:col-span-7">
            Each yard&apos;s page lists every vehicle, newest first, with where
            it sits in the yard when the yard says.
          </p>
        </div>
        <div className="mt-(--space-xl)">
          <YardList yards={ranked} checkDates={checkDates} />
        </div>
      </section>
    </PublicPageShell>
  );
}
