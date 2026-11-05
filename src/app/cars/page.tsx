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
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        Junkyard inventory by make
      </h1>
      <p className="mt-3 text-base text-pretty">
        Pick a make to see its models and the yards that have them, with every
        vehicle&apos;s VIN and date added.
      </p>
      <ul className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {common.map((make) => (
          <li key={make.key}>
            <Link
              href={make.href}
              prefetch={false}
              className="hover:bg-muted flex h-full flex-col rounded-lg border p-3"
            >
              <span className="text-sm font-medium">{make.name}</span>
              <span className="text-muted-foreground mt-1 text-xs tabular-nums">
                {InventoryFormat.plural(make.count, "vehicle", "vehicles")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {rare.length > 0 && (
        <section aria-labelledby="rare-title" className="mt-10">
          <h2 id="rare-title" className="text-sm font-medium">
            Rarely in the yards
          </h2>
          <ul className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {rare.map((make) => (
              <li key={make.key}>
                <Link
                  href={make.href}
                  prefetch={false}
                  className="hover:text-foreground underline-offset-4 hover:underline"
                >
                  {make.name}
                </Link>{" "}
                <span className="tabular-nums">{make.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PublicPageShell>
  );
}
