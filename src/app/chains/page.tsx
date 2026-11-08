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
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        Junkyard chains
      </h1>
      <p className="mt-3 text-base text-pretty">
        Chains with more than one yard we track. Each links to its yards&apos;
        full inventories. Other yards are listed{" "}
        <Link href="/junkyards" className="underline underline-offset-4">
          by state
        </Link>
        .
      </p>
      <ul className="mt-6 divide-y border-y">
        {chains.map((chain) => {
          const vehicles = chain.yards.reduce(
            (sum, yard) => sum + yard.vehicleCount,
            0,
          );
          return (
            <li key={chain.slug}>
              <Link
                href={chain.href}
                prefetch={false}
                className="hover:bg-muted/60 flex items-baseline justify-between gap-4 px-1 py-3"
              >
                <span className="font-medium">{chain.name}</span>
                <span className="text-muted-foreground shrink-0 text-sm tabular-nums">
                  {InventoryFormat.plural(chain.yards.length, "yard", "yards")}{" "}
                  · {InventoryFormat.count(vehicles)} vehicles
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </PublicPageShell>
  );
}
