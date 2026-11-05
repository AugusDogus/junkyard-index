import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { YardList } from "~/components/junkyards/YardList";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { InventoryFormat } from "~/lib/inventory-format";
import { MakeInventory } from "~/lib/make-inventory";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData } from "~/lib/structured-data";
import { VehicleName } from "~/lib/vehicle-name";
import { getMakePageData } from "~/server/vehicle-models";
import { latestPublishedAt, type RoutedYard } from "~/server/yard-inventory";

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
  const publishedAt = await latestPublishedAt(yards.map(({ yard }) => yard));
  return {
    ...data,
    yards,
    publishedAt,
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
  const { make, yards, publishedAt } = data;
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
  const { make, models, yards, publishedAt } = data;
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Cars", href: "/cars" },
    { name: make.name, href: make.href },
  ];

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
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {make.name} at junkyards
      </h1>
      <p className="mt-3 text-base text-pretty">
        <span className="font-medium tabular-nums">
          {InventoryFormat.plural(
            make.count,
            `${make.name} vehicle`,
            `${make.name} vehicles`,
          )}
        </span>{" "}
        across {InventoryFormat.plural(models.length, "model", "models")}, at{" "}
        {InventoryFormat.plural(yards.length, "yard", "yards")} we track.{" "}
        {publishedAt && (
          <span className="text-muted-foreground">
            Inventory updated{" "}
            <time dateTime={publishedAt}>
              {InventoryFormat.date(publishedAt)}
            </time>
            .
          </span>
        )}
      </p>

      <section aria-labelledby="models-title" className="mt-8">
        <h2 id="models-title" className="text-xl font-semibold">
          {make.name} models
        </h2>
        <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {models.map((model) => (
            <li key={model.key}>
              <Link
                href={model.href}
                prefetch={false}
                className="hover:bg-muted flex h-full flex-col rounded-lg border p-3"
              >
                <span className="text-sm font-medium text-pretty">
                  {model.name}
                </span>
                <span className="text-muted-foreground mt-1 text-xs tabular-nums">
                  {InventoryFormat.count(model.count)} ·{" "}
                  {InventoryFormat.years(model)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="yards-title" className="mt-10">
        <h2 id="yards-title" className="text-xl font-semibold">
          Yards with the most {make.name} vehicles
        </h2>
        <div className="mt-4">
          <YardList
            yards={yards.slice(0, TOP_YARDS).map(({ yard, count }) => ({
              ...yard,
              vehicleCount: count,
            }))}
          />
        </div>
      </section>
    </PublicPageShell>
  );
}
