import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { FreshnessBadge } from "~/components/inventory/FreshnessBadge";
import { YardRows } from "~/components/inventory/YardRows";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { JsonLd } from "~/components/JsonLd";
import { Button } from "~/components/ui/button";
import { env } from "~/env";
import { InventoryFormat } from "~/lib/inventory-format";
import {
  INDEXABLE_MINIMUM,
  MakeInventory,
  type ModelEntry,
} from "~/lib/make-inventory";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData } from "~/lib/structured-data";
import { VehicleName } from "~/lib/vehicle-name";
import { getMakePageData } from "~/server/vehicle-models";
import { YardName } from "~/lib/yard-name";
import { YardPath } from "~/lib/yard-path";
import { inventoryFreshness, type RoutedYard } from "~/server/yard-inventory";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { make: string };

export function generateStaticParams(): Params[] {
  return [];
}

const TOP_YARDS = 12;

async function load(params: Promise<Params>) {
  const requested = (await params).make;
  const data = await getMakePageData(requested);
  if (!data) return null;
  // The make's vehicles per yard, across all its models.
  const counts = new Map<string, number>();
  for (const model of data.models) {
    for (const yard of model.yards) {
      const key = `${yard.source}:${yard.code}`;
      counts.set(key, (counts.get(key) ?? 0) + yard.count);
    }
  }
  const yards = [...counts.entries()]
    .flatMap(([key, count]): { yard: RoutedYard; count: number }[] => {
      const yard = data.yards.get(key);
      return yard ? [{ yard, count }] : [];
    })
    .sort((a, b) => b.count - a.count);
  const freshness = await inventoryFreshness(yards.map(({ yard }) => yard));
  return {
    ...data,
    yards,
    freshness,
    canonical: requested === data.make.slug,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const data = await load(params);
  if (!data) return {};
  const { make, yards } = data;
  const publishedAt = data.freshness.latest;
  const title = `${make.name} Junkyard Inventory: ${InventoryFormat.plural(make.count, "Vehicle", "Vehicles")}`;
  const description = `${InventoryFormat.plural(make.count, `${make.name} vehicle`, `${make.name} vehicles`)} at ${InventoryFormat.plural(yards.length, "salvage yard", "salvage yards")}, by model, with the yards that have the most.${
    publishedAt ? ` Updated ${InventoryFormat.date(publishedAt)}.` : ""
  }`;
  return {
    title,
    description,
    alternates: { canonical: make.href },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      type: "website",
      url: make.href,
      title,
      description,
    },
    twitter: { card: "summary", title, description },
    ...(!MakeInventory.indexable(make) && {
      robots: { index: false, follow: true },
    }),
  };
}

export default async function MakePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const data = await load(params);
  if (!data) notFound();
  if (!data.canonical) permanentRedirect(data.make.href);
  const { make, models, yards, freshness } = data;
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Cars", href: "/cars" },
    { name: make.name, href: make.href },
  ];
  const popular = models.filter((model) => MakeInventory.indexable(model));
  const rare = models.filter((model) => !MakeInventory.indexable(model));

  return (
    <PublicPageShell>
      <JsonLd
        nodes={[
          StructuredData.breadcrumbs(env.NEXT_PUBLIC_APP_URL, crumbs),
          {
            "@type": "ItemList",
            name: `${make.name} models at junkyards`,
            numberOfItems: models.length,
            itemListElement: models.map((model, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: new URL(model.href, env.NEXT_PUBLIC_APP_URL).toString(),
              name: VehicleName.title(make.name, model.name),
            })),
          },
        ]}
      />
      <Breadcrumbs crumbs={crumbs} />
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {make.name} at junkyards
        </h1>
        <p className="mt-3 text-base text-pretty">
          <span className="font-semibold tabular-nums">
            {InventoryFormat.count(make.count)}
          </span>{" "}
          in stock across{" "}
          {InventoryFormat.plural(models.length, "model", "models")}, at{" "}
          <span className="font-semibold tabular-nums">
            {InventoryFormat.plural(yards.length, "yard", "yards")}
          </span>{" "}
          we track.
        </p>
        <div className="mt-2">
          <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
        </div>
        <div className="mt-5">
          <Button asChild>
            <Link
              href={`/search?q=${encodeURIComponent(make.name)}`}
              prefetch={false}
            >
              <Search aria-hidden="true" data-icon="inline-start" />
              Search every {make.name}
            </Link>
          </Button>
        </div>
      </header>

      <section aria-labelledby="models-title" className="mt-10">
        <h2 id="models-title" className="text-lg font-semibold">
          Pick a model
        </h2>
        <ModelRows models={popular.length > 0 ? popular : rare} />
        {popular.length > 0 && rare.length > 0 && (
          <details className="mt-2">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer py-2 text-sm">
              {InventoryFormat.plural(rare.length, "more model", "more models")}{" "}
              with fewer than {INDEXABLE_MINIMUM} in stock
            </summary>
            <ModelRows models={rare} />
          </details>
        )}
      </section>

      <section aria-labelledby="yards-title" className="mt-10">
        <h2 id="yards-title" className="text-lg font-semibold">
          Yards with the most {make.name} vehicles
        </h2>
        <div className="mt-3">
          <YardRows
            rows={yards.slice(0, TOP_YARDS).map(({ yard, count }) => ({
              href: YardPath.makeHref(yard.path, make.slug),
              name: YardName.headline(yard.name, yard.operator),
              place: `${yard.city}, ${yard.state}`,
              figure: InventoryFormat.count(count),
            }))}
          />
        </div>
      </section>
    </PublicPageShell>
  );
}

/** A make's models as compact rows: name, how many, and which years. */
function ModelRows({ models }: { models: readonly ModelEntry[] }) {
  return (
    <ul className="mt-3 grid gap-x-8 border-t sm:grid-cols-2">
      {models.map((model) => (
        <li key={model.key} className="border-b">
          <Link
            href={model.href}
            prefetch={false}
            className="hover:bg-muted/60 flex items-baseline justify-between gap-4 px-1 py-2.5"
          >
            <span className="truncate text-sm font-medium">{model.name}</span>
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {InventoryFormat.count(model.count)} ·{" "}
              {InventoryFormat.years(model)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
