import { Minus, Plus } from "lucide-react";
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
import { cn } from "~/lib/utils";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;

const TITLE = "Junkyards with Live Inventory by State";
const DESCRIPTION =
  "Every salvage yard we track, by state, with a live vehicle count and a full inventory page for each yard. Listings are checked daily.";

/** State, yards, vehicles: shared by the head row and every state row. */
const REGION_TRACKS = "grid-cols-[minmax(0,1fr)_3.5rem_6rem] gap-x-3";

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
      <header>
        <h1 className="text-display-s leading-[1.02] font-extrabold">
          Junkyards with live inventory
        </h1>
        <p className="text-lead text-ink-2 mt-5 max-w-[56ch] leading-[1.45]">
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.count(yards.length)}
          </span>{" "}
          self-service yards in{" "}
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.count(groups.length)}
          </span>{" "}
          states and provinces, listing{" "}
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.count(vehicles)}
          </span>{" "}
          vehicles.
        </p>
      </header>
      <div className="mt-5">
        <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
      </div>

      {/* The index: every state, largest first, read down each column. */}
      <section aria-labelledby="states-title" className="mt-(--space-2xl)">
        <div className="grid gap-y-3 lg:grid-cols-12 lg:items-baseline lg:gap-x-8">
          <h2
            id="states-title"
            className="text-section leading-[1.02] font-extrabold lg:col-span-5"
          >
            By state
          </h2>
          <p className="text-lead text-ink-2 leading-[1.45] lg:col-span-7">
            Pick your state, then a yard, to see everything it has.
          </p>
        </div>
        <div
          aria-hidden="true"
          className="border-ink text-ink-3 mt-(--space-xl) grid grid-cols-1 gap-x-10 border-b-2 pb-2 text-sm font-medium sm:grid-cols-2 lg:grid-cols-3"
        >
          {/* One head per column the list runs down. */}
          {[0, 1, 2].map((column) => (
            <span
              key={column}
              className={cn(
                REGION_TRACKS,
                "grid px-2",
                column === 1 && "hidden sm:grid",
                column === 2 && "hidden lg:grid",
              )}
            >
              <span>State</span>
              <span className="text-right">Yards</span>
              <span className="text-right">Vehicles</span>
            </span>
          ))}
        </div>
        <ul className="gap-x-10 sm:columns-2 lg:columns-3">
          {regionRows.map(({ region, yards: regionYards, vehicles: count }) => (
            <li
              key={region.slug}
              className="border-rule break-inside-avoid border-b"
            >
              <Link
                href={YardPath.regionHref(region)}
                prefetch={false}
                className={cn(
                  REGION_TRACKS,
                  "group board-step hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus grid items-baseline px-2 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid",
                )}
              >
                <span className="board-step group-hover:text-signal text-[0.9375rem] leading-snug font-extrabold">
                  {region.name}
                </span>
                <span className="text-ink-2 text-right text-sm tabular-nums">
                  {InventoryFormat.count(regionYards.length)}
                  <span className="sr-only">
                    {regionYards.length === 1 ? " yard" : " yards"},
                  </span>
                </span>
                <span className="text-right font-extrabold tabular-nums">
                  {InventoryFormat.count(count)}
                  <span className="sr-only"> vehicles</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Chains on the board: the one ink band on the page. */}
      <section
        aria-labelledby="chains-title"
        className="bg-board text-board-ink border-ink mt-(--section-gap-s) grid gap-y-(--space-xl) border-2 px-4 py-8 sm:p-8 lg:grid-cols-12 lg:gap-x-8 lg:p-10"
      >
        <h2
          id="chains-title"
          className="text-section leading-[1.02] font-extrabold lg:col-span-4"
        >
          By chain
        </h2>
        <ul className="border-board-ink border-t-2 lg:col-span-8">
          {chains.map((chain) => (
            <li key={chain.slug} className="border-board-rule border-b">
              <Link
                href={chain.href}
                prefetch={false}
                className="board-step hover:bg-board-2 active:bg-board-2 focus-visible:outline-figure flex items-baseline justify-between gap-6 px-2 py-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
              >
                <span className="min-w-0 text-[1.0625rem] leading-snug font-extrabold">
                  {chain.name}
                </span>
                <span className="text-board-muted shrink-0 text-sm whitespace-nowrap">
                  <span className="text-figure text-title font-extrabold tabular-nums">
                    {InventoryFormat.count(chain.yards.length)}
                  </span>{" "}
                  {chain.yards.length === 1 ? "yard" : "yards"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="all-title"
        className="mt-(--section-gap) grid gap-y-(--space-xl) lg:grid-cols-12 lg:gap-x-8"
      >
        <h2
          id="all-title"
          className="text-section leading-[1.02] font-extrabold lg:sticky lg:top-28 lg:col-span-4 lg:self-start"
        >
          Every yard
        </h2>
        <div className="border-ink border-t-2 lg:col-span-8">
          {groups.map(({ region, yards: regionYards }) => (
            <details key={region.slug} className="group border-rule border-b">
              <summary className="board-step hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus flex list-none items-center justify-between gap-4 px-2 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid [&::-webkit-details-marker]:hidden">
                <span className="text-[0.9375rem] font-extrabold">
                  {region.name}
                </span>
                <span className="flex items-center gap-4">
                  <span className="text-ink-2 text-sm tabular-nums">
                    {InventoryFormat.plural(
                      regionYards.length,
                      "yard",
                      "yards",
                    )}
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
                <YardList yards={regionYards} />
              </div>
            </details>
          ))}
        </div>
      </section>
    </PublicPageShell>
  );
}
