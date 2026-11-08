import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { InventoryFormat } from "~/lib/inventory-format";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData } from "~/lib/structured-data";
import { getChains } from "~/server/yard-inventory";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;

const TITLE = "Junkyard Chains with Live Inventory";
const DESCRIPTION =
  "Every junkyard chain we track, with how many yards and vehicles each has and a live inventory page for every yard.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/chains" },
  openGraph: {
    ...SITE_OPEN_GRAPH,
    type: "website",
    url: "/chains",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

export default async function ChainsPage() {
  const chains = await getChains();
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Chains", href: "/chains" },
  ];

  return (
    <PublicPageShell>
      <JsonLd
        nodes={[StructuredData.breadcrumbs(env.NEXT_PUBLIC_APP_URL, crumbs)]}
      />
      <Breadcrumbs crumbs={crumbs} />
      <header>
        <h1 className="text-display-s leading-[1.02] font-extrabold">
          Junkyard chains
        </h1>
        <p className="text-lead text-ink-2 mt-5 max-w-[56ch] leading-[1.45]">
          Chains with more than one yard we track.
        </p>
      </header>

      {/* The chains on the board, their counts as amber figures. */}
      <div className="bg-board text-board-ink border-ink mt-(--space-2xl) border-2 px-4 py-6 sm:px-8 sm:py-8 lg:px-10">
        <ul className="border-board-ink border-t-2">
          {chains.map((chain) => {
            const vehicles = chain.yards.reduce(
              (sum, yard) => sum + yard.vehicleCount,
              0,
            );
            return (
              <li key={chain.slug} className="border-board-rule border-b">
                <Link
                  href={chain.href}
                  prefetch={false}
                  className="board-step hover:bg-board-2 active:bg-board-2 focus-visible:outline-figure grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-8 gap-y-1 px-2 py-5 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid md:grid-cols-[minmax(0,1fr)_9rem_13rem]"
                >
                  <span className="text-title col-span-2 leading-tight font-extrabold md:col-span-1">
                    {chain.name}
                  </span>
                  <span className="text-board-muted text-sm whitespace-nowrap md:text-right">
                    <span className="text-figure text-title font-extrabold tabular-nums">
                      {InventoryFormat.count(chain.yards.length)}
                    </span>{" "}
                    {chain.yards.length === 1 ? "yard" : "yards"}
                  </span>
                  <span className="text-board-muted text-right text-sm whitespace-nowrap">
                    <span className="text-figure text-title font-extrabold tabular-nums">
                      {InventoryFormat.count(vehicles)}
                    </span>{" "}
                    vehicles
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-ink-2 mt-8 max-w-[65ch] text-base leading-relaxed text-pretty">
        Each links to its yards&apos; full inventories. Other yards are listed{" "}
        <Link
          href="/junkyards"
          className="board-step text-ink hover:text-signal active:text-ink focus-visible:outline-focus underline decoration-1 underline-offset-[0.3em] outline-none hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
        >
          by state
        </Link>
        .
      </p>
    </PublicPageShell>
  );
}
