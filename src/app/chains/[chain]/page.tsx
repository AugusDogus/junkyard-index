import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { YardList } from "~/components/junkyards/YardList";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { InventoryFormat } from "~/lib/inventory-format";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData } from "~/lib/structured-data";
import { YardName } from "~/lib/yard-name";
import { YardPath } from "~/lib/yard-path";
import { FreshnessBadge } from "~/components/inventory/FreshnessBadge";
import {
  findChain,
  inventoryFreshness,
  latestPublishedAt,
} from "~/server/yard-inventory";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { chain: string };

const TOP_YARDS = 10;

export function generateStaticParams(): Params[] {
  return [];
}

function summarize(yards: readonly { vehicleCount: number; path: YardPath }[]) {
  const regions = [
    ...new Map(
      yards.map(({ path: { region } }) => [region.slug, region]),
    ).values(),
  ];
  const states = regions.filter((region) => region.country === "US").length;
  const provinces = regions.length - states;
  return {
    vehicles: yards.reduce((sum, yard) => sum + yard.vehicleCount, 0),
    /** "16 states and 2 provinces", "3 states", "1 province". */
    regions: [
      states > 0 && InventoryFormat.plural(states, "state", "states"),
      provinces > 0 &&
        InventoryFormat.plural(provinces, "province", "provinces"),
    ]
      .filter(Boolean)
      .join(" and "),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const chain = await findChain((await params).chain);
  if (!chain) return {};
  const { vehicles, regions } = summarize(chain.yards);
  const publishedAt = await latestPublishedAt(chain.yards);
  const title = `${chain.name} Inventory at ${InventoryFormat.count(chain.yards.length)} Yards`;
  const description = `Browse every vehicle at the ${InventoryFormat.count(chain.yards.length)} ${chain.name} yards we track in ${regions}: ${InventoryFormat.count(vehicles)} vehicles with VIN and date added.${
    publishedAt ? ` Updated ${InventoryFormat.date(publishedAt)}.` : ""
  }`;
  return {
    title,
    description,
    alternates: { canonical: chain.href },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      type: "website",
      url: chain.href,
      title,
      description,
    },
    twitter: { card: "summary", title, description },
  };
}

export default async function ChainPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const chain = await findChain((await params).chain);
  if (!chain) notFound();
  const { vehicles, regions } = summarize(chain.yards);
  const freshness = await inventoryFreshness(chain.yards);
  const largest = [...chain.yards]
    .sort((a, b) => b.vehicleCount - a.vehicleCount)
    .slice(0, TOP_YARDS);
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Chains", href: "/chains" },
    { name: chain.name, href: chain.href },
  ];

  return (
    <PublicPageShell>
      <JsonLd
        nodes={[
          StructuredData.breadcrumbs(env.NEXT_PUBLIC_APP_URL, crumbs),
          {
            "@type": "ItemList",
            name: `${chain.name} yards`,
            numberOfItems: chain.yards.length,
            itemListElement: chain.yards.map((yard, index) => ({
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
        {chain.name} inventory
      </h1>
      <p className="mt-3 text-base text-pretty">
        <span className="font-semibold tabular-nums">
          {InventoryFormat.plural(chain.yards.length, "yard", "yards")}
        </span>{" "}
        in {regions}, listing{" "}
        <span className="font-semibold tabular-nums">
          {InventoryFormat.count(vehicles)}
        </span>{" "}
        vehicles. Pick a yard to see everything it has, newest first.
      </p>
      <div className="mt-2">
        <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
      </div>
      <section aria-labelledby="largest-title" className="mt-8">
        <h2 id="largest-title" className="text-lg font-semibold">
          Largest {chain.name} yards
        </h2>
        <div className="mt-3">
          <YardList yards={largest} />
        </div>
      </section>
      {chain.yards.length > TOP_YARDS && (
        <section aria-labelledby="states-title" className="mt-10">
          <h2 id="states-title" className="text-lg font-semibold">
            Every {chain.name} yard, by state
          </h2>
          <div className="mt-3 divide-y border-y">
            {YardPath.byRegion(chain.yards).map(({ region, yards }) => (
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
                    {InventoryFormat.plural(yards.length, "yard", "yards")}
                  </span>
                </summary>
                <div className="pb-3">
                  <YardList yards={yards} />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
      <p className="text-muted-foreground mt-10 text-sm">
        Looking for another chain or an independent yard? See{" "}
        <Link
          href="/junkyards"
          className="hover:text-foreground underline underline-offset-4"
        >
          every yard by state
        </Link>
        .
      </p>
    </PublicPageShell>
  );
}
