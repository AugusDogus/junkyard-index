import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { PublicPageShell } from "~/components/junkyards/PublicPageShell";
import { YardList } from "~/components/junkyards/YardList";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { Slug } from "~/lib/slug";
import { StructuredData } from "~/lib/structured-data";
import { YardName } from "~/lib/yard-name";
import { YardPath } from "~/lib/yard-path";
import { findRegionYards, type RoutedYard } from "~/server/yard-inventory";

// Rebuilt after each daily ingestion pass; this is the fallback lifetime.
export const revalidate = 86400;
export const dynamicParams = true;

type Params = { state: string };

export function generateStaticParams(): Params[] {
  return [];
}

const count = (value: number) => value.toLocaleString("en-US");

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const found = await findRegionYards((await params).state);
  if (!found) return {};
  const { region, yards } = found;
  const vehicles = yards.reduce((sum, yard) => sum + yard.vehicleCount, 0);
  const title = `Junkyards in ${region.name} with Live Inventory`;
  const description = `${count(yards.length)} salvage ${yards.length === 1 ? "yard" : "yards"} in ${region.name} with ${count(vehicles)} vehicles listed. See each yard's full inventory, checked daily.`;
  const url = YardPath.regionHref(region);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...SITE_OPEN_GRAPH, type: "website", url, title, description },
    twitter: { card: "summary", title, description },
  };
}

export default async function RegionPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const found = await findRegionYards((await params).state);
  if (!found) notFound();
  const { region, yards } = found;
  const vehicles = yards.reduce((sum, yard) => sum + yard.vehicleCount, 0);
  const crumbs = [
    { name: "Home", href: "/" },
    { name: "Junkyards", href: "/junkyards" },
    { name: region.name, href: YardPath.regionHref(region) },
  ];
  // Group by slug so spellings that differ only in case or punctuation share
  // a section; the first spelling seen names it.
  const byCity = new Map<string, { name: string; yards: RoutedYard[] }>();
  for (const yard of yards) {
    const key = Slug.from(yard.city);
    const group = byCity.get(key) ?? { name: yard.city, yards: [] };
    group.yards.push(yard);
    byCity.set(key, group);
  }
  const cities = [...byCity.entries()].sort(([, a], [, b]) =>
    a.name.localeCompare(b.name),
  );

  return (
    <PublicPageShell>
      <JsonLd
        nodes={[
          StructuredData.breadcrumbs(env.NEXT_PUBLIC_APP_URL, crumbs),
          {
            "@type": "ItemList",
            name: `Junkyards in ${region.name}`,
            numberOfItems: yards.length,
            itemListElement: yards.map((yard, index) => ({
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
        Junkyards in {region.name}
      </h1>
      <p className="mt-3 text-base text-pretty">
        <span className="font-medium tabular-nums">
          {count(yards.length)} {yards.length === 1 ? "yard" : "yards"}
        </span>{" "}
        in {region.name} list{" "}
        <span className="font-medium tabular-nums">{count(vehicles)}</span>{" "}
        vehicles. Each yard&apos;s page lists every vehicle with its VIN and
        date added, plus its row where the yard lists one. We check every
        yard&apos;s listings daily.
      </p>
      {cities.map(([key, city]) => (
        <section key={key} className="mt-8" aria-labelledby={`city-${key}`}>
          <h2 id={`city-${key}`} className="mb-3 text-lg font-semibold">
            {city.name}
          </h2>
          <YardList yards={city.yards} />
        </section>
      ))}
    </PublicPageShell>
  );
}
