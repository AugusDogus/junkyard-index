import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { InventoryFormat } from "~/lib/inventory-format";
import { MakeInventory } from "~/lib/make-inventory";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData } from "~/lib/structured-data";
import { cn } from "~/lib/utils";
import { getMakes } from "~/server/vehicle-models";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;

const TITLE = "Junkyard Inventory by Make";
const DESCRIPTION =
  "Every make in the salvage yards we track, with live counts by model and a page listing the yards that have each one.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/cars" },
  openGraph: {
    ...SITE_OPEN_GRAPH,
    type: "website",
    url: "/cars",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: "summary", title: TITLE, description: DESCRIPTION },
};

/** One column head per board column: one on phones, two, then three. */
const COLUMN_HEADS = ["flex", "hidden sm:flex", "hidden lg:flex"] as const;

export default async function CarsPage() {
  const makes = await getMakes();
  const [common, rare] = [
    makes.filter((make) => MakeInventory.indexable(make)),
    makes.filter((make) => !MakeInventory.indexable(make)),
  ];
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Cars", href: "/cars" },
  ];

  return (
    <PublicPageShell>
      <JsonLd
        nodes={[StructuredData.breadcrumbs(env.NEXT_PUBLIC_APP_URL, crumbs)]}
      />
      <Breadcrumbs crumbs={crumbs} />
      <header>
        <h1 className="text-display-s leading-[1.02] font-extrabold">
          Junkyard inventory by make
        </h1>
        <p className="text-lead text-ink-2 mt-5 max-w-[60ch] leading-[1.45]">
          Pick a make to see its models and the yards that have them, with every
          vehicle&apos;s VIN and date added.
        </p>
      </header>
      {/* The makes as a departure board: name, then its count in amber. */}
      <div className="bg-board text-board-ink border-ink mt-(--space-2xl) border-2 px-3 pb-4 sm:px-6 sm:pb-6 lg:mt-(--space-3xl) lg:px-8">
        <div
          aria-hidden="true"
          className="border-board-ink text-board-muted grid gap-x-10 border-b-2 pt-5 pb-3 text-sm font-medium sm:grid-cols-2 lg:grid-cols-3"
        >
          {COLUMN_HEADS.map((visibility) => (
            <p
              key={visibility}
              className={cn("justify-between gap-4 px-2", visibility)}
            >
              <span>Make</span>
              <span>Vehicles</span>
            </p>
          ))}
        </div>
        <ul className="gap-x-10 sm:columns-2 lg:columns-3">
          {common.map((make) => (
            <li
              key={make.key}
              className="border-board-rule break-inside-avoid border-b"
            >
              <Link
                href={make.href}
                prefetch={false}
                className="board-step hover:bg-board-2 active:bg-board-2 focus-visible:outline-figure flex items-baseline justify-between gap-4 px-2 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
              >
                <span className="min-w-0 text-[0.9375rem] font-medium">
                  {make.name}
                </span>
                <span className="text-figure text-title shrink-0 leading-none font-extrabold tabular-nums">
                  {InventoryFormat.count(make.count)}
                  <span className="sr-only">
                    {make.count === 1 ? " vehicle" : " vehicles"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      {rare.length > 0 && (
        <section aria-labelledby="rare-title" className="mt-(--section-gap)">
          <h2
            id="rare-title"
            className="text-section leading-[1.02] font-extrabold"
          >
            Rarely in the yards
          </h2>
          <ul className="border-ink mt-(--space-xl) columns-2 gap-x-8 border-t-2 sm:columns-3 lg:columns-5">
            {rare.map((make) => (
              <li
                key={make.key}
                className="border-rule break-inside-avoid border-b"
              >
                <Link
                  href={make.href}
                  prefetch={false}
                  className="board-step hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus flex items-baseline justify-between gap-3 px-2 py-3 text-[0.9375rem] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
                >
                  <span className="min-w-0 font-medium">{make.name}</span>
                  <span className="shrink-0 font-extrabold tabular-nums">
                    {make.count}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PublicPageShell>
  );
}
