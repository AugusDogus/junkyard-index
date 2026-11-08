import { Minus, Plus } from "lucide-react";
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
      <header>
        <h1 className="text-display-s leading-[1.02] font-extrabold">
          {chain.name} inventory
        </h1>
        <p className="text-lead text-ink-2 mt-5 max-w-[56ch] leading-[1.45]">
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.plural(chain.yards.length, "yard", "yards")}
          </span>{" "}
          in {regions}, listing{" "}
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.count(vehicles)}
          </span>{" "}
          vehicles.
        </p>
      </header>
      <div className="mt-5">
        <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
      </div>

      {/* The largest yards on the board: the one ink band on the page. */}
      <section
        aria-labelledby="largest-title"
        className="bg-board text-board-ink border-ink mt-(--space-2xl) border-2 px-4 py-8 sm:p-8 lg:p-10"
      >
        <div className="grid gap-y-3 lg:grid-cols-12 lg:items-baseline lg:gap-x-8">
          <h2
            id="largest-title"
            className="text-section leading-[1.02] font-extrabold lg:col-span-7"
          >
            Largest {chain.name} yards
          </h2>
          <p className="text-board-muted text-lead leading-[1.45] text-pretty lg:col-span-5">
            Pick a yard to see everything it has, newest first.
          </p>
        </div>
        <div className="mt-(--space-xl)">
          <YardList yards={largest} tone="board" />
        </div>
      </section>
      {chain.yards.length > TOP_YARDS && (
        <section
          aria-labelledby="states-title"
          className="mt-(--section-gap) grid gap-y-(--space-xl) lg:grid-cols-12 lg:gap-x-8"
        >
          <h2
            id="states-title"
            className="text-section leading-[1.02] font-extrabold lg:sticky lg:top-28 lg:col-span-4 lg:self-start"
          >
            Every {chain.name} yard, by state
          </h2>
          <div className="border-ink border-t-2 lg:col-span-8">
            {YardPath.byRegion(chain.yards).map(({ region, yards }) => (
              <details key={region.slug} className="group border-rule border-b">
                <summary className="board-step hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus flex list-none items-center justify-between gap-4 px-2 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid [&::-webkit-details-marker]:hidden">
                  <span className="text-[0.9375rem] font-extrabold">
                    {region.name}
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="text-ink-2 text-sm tabular-nums">
                      {InventoryFormat.plural(yards.length, "yard", "yards")}
                    </span>
                    <span
                      className="border-ink group-open:bg-ink group-open:text-paper grid size-8 shrink-0 place-items-center border-2"
                      aria-hidden="true"
                    >
                      <Plus className="size-4 group-open:hidden" />
                      <Minus className="hidden size-4 group-open:block" />
                    </span>
                  </span>
                </summary>
                <div className="pt-2 pb-8">
                  <YardList yards={yards} />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
      <p className="text-ink-2 mt-(--section-gap-s) max-w-[65ch] text-base leading-relaxed text-pretty">
        Looking for another chain or an independent yard? See{" "}
        <Link
          href="/junkyards"
          className="board-step text-ink hover:text-signal active:text-ink focus-visible:outline-focus underline decoration-1 underline-offset-[0.3em] outline-none hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
        >
          every yard by state
        </Link>
        .
      </p>
    </PublicPageShell>
  );
}
