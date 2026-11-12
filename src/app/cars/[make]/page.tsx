import { Minus, Plus, Search } from "lucide-react";
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
        <h1 className="text-display-s leading-[1.02] font-extrabold">
          {make.name} at junkyards
        </h1>
        <p className="text-lead text-ink-2 mt-5 max-w-[60ch] leading-[1.45]">
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.count(make.count)}
          </span>{" "}
          in stock across{" "}
          {InventoryFormat.plural(models.length, "model", "models")}, at{" "}
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.plural(yards.length, "yard", "yards")}
          </span>{" "}
          we track.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Button asChild size="xl" className="max-w-full">
            <Link
              href={`/search?q=${encodeURIComponent(make.name)}`}
              prefetch={false}
            >
              <Search aria-hidden="true" data-icon="inline-start" />
              <span className="truncate">Search every {make.name}</span>
            </Link>
          </Button>
          <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
        </div>
      </header>

      <section
        aria-labelledby="models-title"
        className="mt-(--space-2xl) lg:mt-(--space-3xl)"
      >
        <h2
          id="models-title"
          className="text-section leading-[1.02] font-extrabold"
        >
          Pick a model
        </h2>
        <div className="mt-(--space-xl)">
          <ModelRows models={popular.length > 0 ? popular : rare} />
        </div>
        {popular.length > 0 && rare.length > 0 && (
          <details className="group">
            <summary className="board-step border-rule hover:text-signal focus-visible:outline-focus flex list-none items-center justify-between gap-6 border-b px-2 py-4 text-[0.9375rem] font-medium outline-none group-open:border-transparent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid [&::-webkit-details-marker]:hidden">
              <span>
                {InventoryFormat.plural(
                  rare.length,
                  "more model",
                  "more models",
                )}{" "}
                with fewer than {INDEXABLE_MINIMUM} in stock
              </span>
              <span
                className="border-ink group-open:bg-ink group-open:text-paper grid size-9 shrink-0 place-items-center border-2"
                aria-hidden="true"
              >
                <Plus className="size-4 group-open:hidden" />
                <Minus className="hidden size-4 group-open:block" />
              </span>
            </summary>
            <ModelRows models={rare} />
          </details>
        )}
      </section>

      <section
        aria-labelledby="yards-title"
        className="bg-board text-board-ink border-ink mt-(--section-gap-s) border-2 px-4 py-8 sm:p-8 lg:p-10"
      >
        <h2
          id="yards-title"
          className="text-section leading-[1.02] font-extrabold"
        >
          Yards with the most {make.name} vehicles
        </h2>
        <div className="mt-(--space-xl)">
          <YardRows
            tone="board"
            columns={3}
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

/** Up to three columns, fewer for a short list, so no column holds a lone row. */
function modelColumns(count: number): string {
  if (count >= 9) return "sm:columns-2 lg:columns-3";
  if (count >= 4) return "sm:columns-2";
  return "max-w-2xl";
}

/** A make's models as compact rows: name and years, then how many. */
function ModelRows({ models }: { models: readonly ModelEntry[] }) {
  return (
    <ul
      className={`border-ink gap-x-10 border-t-2 ${modelColumns(models.length)}`}
    >
      {models.map((model) => (
        <li key={model.key} className="border-rule break-inside-avoid border-b">
          <Link
            href={model.href}
            prefetch={false}
            className="board-step hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus flex items-center justify-between gap-4 px-2 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
          >
            <span className="min-w-0">
              <span className="block text-[0.9375rem] leading-snug font-medium text-pretty">
                {model.name}
              </span>
              <span className="text-ink-3 block text-sm tabular-nums">
                {InventoryFormat.years(model)}
              </span>
            </span>
            <span className="shrink-0 text-lg leading-tight font-extrabold tabular-nums">
              {InventoryFormat.count(model.count)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
