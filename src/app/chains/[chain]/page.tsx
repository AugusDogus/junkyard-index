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
import { findChain, latestPublishedAt } from "~/server/yard-inventory";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { chain: string };

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
  const publishedAt = await latestPublishedAt(chain.yards);
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
        We track{" "}
        <span className="font-medium tabular-nums">
          {InventoryFormat.count(chain.yards.length)}
        </span>{" "}
        {chain.name} yards in {regions}, listing{" "}
        <span className="font-medium tabular-nums">
          {InventoryFormat.count(vehicles)}
        </span>{" "}
        vehicles. Pick a yard to see every vehicle there with its VIN and date
        added, newest first.{" "}
        {publishedAt ? (
          <span className="text-muted-foreground">
            Inventory updated{" "}
            <time dateTime={publishedAt}>
              {InventoryFormat.date(publishedAt)}
            </time>
            .
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">
            This inventory has not refreshed in the last 3 days, so some
            listings may be gone.
          </span>
        )}
      </p>
      {YardPath.byRegion(chain.yards).map(({ region, yards }) => (
        <section
          key={region.slug}
          className="mt-8"
          aria-labelledby={`region-${region.slug}`}
        >
          <h2
            id={`region-${region.slug}`}
            className="mb-3 text-lg font-semibold"
          >
            {chain.name} in {region.name}
          </h2>
          <YardList yards={yards} />
        </section>
      ))}
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
