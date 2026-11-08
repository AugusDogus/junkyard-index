import { ArrowDown, ArrowRight, ChevronRight, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FreshnessBadge } from "~/components/inventory/FreshnessBadge";
import { VehicleRow } from "~/components/inventory/VehicleRow";
import { YardRows } from "~/components/inventory/YardRows";
import { AlertsCallout } from "~/components/junkyards/AlertsCallout";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { JsonLd } from "~/components/JsonLd";
import { Button } from "~/components/ui/button";
import { env } from "~/env";
import { InventoryFormat } from "~/lib/inventory-format";
import { MakeInventory, type ModelEntry } from "~/lib/make-inventory";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData, type Crumb } from "~/lib/structured-data";
import { VehicleName } from "~/lib/vehicle-name";
import { YardName } from "~/lib/yard-name";
import { YardPath } from "~/lib/yard-path";
import type { MakeEntry, ModelArrival } from "~/server/vehicle-models";
import type { InventoryFreshness, RoutedYard } from "~/server/yard-inventory";

function regionLabel(yards: readonly RoutedYard[]): string {
  const regions = [
    ...new Map(
      yards.map(({ path: { region } }) => [region.slug, region]),
    ).values(),
  ];
  const states = regions.filter((region) => region.country === "US").length;
  const provinces = regions.length - states;
  return [
    states > 0 && InventoryFormat.plural(states, "state", "states"),
    provinces > 0 && InventoryFormat.plural(provinces, "province", "provinces"),
  ]
    .filter(Boolean)
    .join(" and ");
}

export function modelCrumbs(make: MakeEntry, model: ModelEntry): Crumb[] {
  return [
    { name: "Home", href: "/" },
    { name: "Cars", href: "/cars" },
    { name: make.name, href: make.href },
    { name: model.name, href: model.href },
  ];
}

/** Title, description, canonical, and indexing for a model page. */
export function modelPageMetadata(
  make: MakeEntry,
  model: ModelEntry,
  yardCount: number,
  publishedAt: string | null,
): Metadata {
  const name = VehicleName.title(make.name, model.name);
  const title = `${name} at Junkyards: ${InventoryFormat.count(model.count)} in Stock`;
  const description = `${InventoryFormat.plural(model.count, `${name} vehicle`, `${name} vehicles`)} at ${InventoryFormat.plural(yardCount, "salvage yard", "salvage yards")}, model years ${InventoryFormat.years(model)}, with the newest arrivals and where each sits in the yard.${
    publishedAt ? ` Updated ${InventoryFormat.date(publishedAt)}.` : ""
  }`;
  return {
    title,
    description,
    alternates: { canonical: model.href },
    openGraph: {
      ...SITE_OPEN_GRAPH,
      type: "website",
      url: model.href,
      title,
      description,
    },
    twitter: { card: "summary", title, description },
    ...(!MakeInventory.indexable(model) && {
      robots: { index: false, follow: true },
    }),
  };
}

const TOP_YARDS = 10;
const SIBLINGS = 12;

export type ModelYard = { yard: RoutedYard; count: number; years: string };

export function ModelInventoryView({
  make,
  model,
  siblings,
  yards,
  arrivals,
  freshness,
  sourcePublishedAt,
}: {
  make: MakeEntry;
  model: ModelEntry;
  /** The make's other models, most first. */
  siblings: readonly ModelEntry[];
  /** Yards holding the model, most first. */
  yards: readonly ModelYard[];
  arrivals: readonly ModelArrival[];
  freshness: InventoryFreshness;
  /** Each source's latest update, for the "New" labels. */
  sourcePublishedAt: Readonly<Partial<Record<string, string>>>;
}) {
  const name = VehicleName.title(make.name, model.name);
  const crumbs = modelCrumbs(make, model);
  const byKey = new Map(
    yards.map(({ yard }) => [YardPath.key(yard), yard] as const),
  );
  const routed = yards.map(({ yard }) => yard);
  // A yard's page narrowed to this make keeps the visitor's context.
  const yardHref = (yard: RoutedYard) =>
    YardPath.makeHref(yard.path, make.slug);
  const searchHref = `/search?q=${encodeURIComponent(name)}`;

  return (
    <>
      <JsonLd
        nodes={[
          StructuredData.breadcrumbs(env.NEXT_PUBLIC_APP_URL, crumbs),
          StructuredData.vehicles(
            `${name} at junkyards`,
            model.count,
            0,
            arrivals,
          ),
        ]}
      />
      <Breadcrumbs crumbs={crumbs} />
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {name} at junkyards
        </h1>
        <p className="mt-3 text-base text-pretty">
          <span className="font-semibold tabular-nums">
            {InventoryFormat.count(model.count)}
          </span>{" "}
          in stock at{" "}
          <span className="font-semibold tabular-nums">
            {InventoryFormat.plural(yards.length, "yard", "yards")}
          </span>{" "}
          in {regionLabel(routed)}, model years {InventoryFormat.years(model)}.
        </p>
        <div className="mt-2">
          <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button asChild>
            <Link href={searchHref} prefetch={false}>
              <Search aria-hidden="true" data-icon="inline-start" />
              Search every {name}
            </Link>
          </Button>
        </div>
      </header>

      <section aria-labelledby="top-yards-title" className="mt-10">
        <h2 id="top-yards-title" className="text-lg font-semibold">
          Yards with the most
        </h2>
        <div className="mt-3">
          <YardRows
            rows={yards.slice(0, TOP_YARDS).map(({ yard, count, years }) => ({
              href: yardHref(yard),
              name: YardName.headline(yard.name, yard.operator),
              place: `${yard.city}, ${yard.state}`,
              figure: InventoryFormat.count(count),
              detail: years,
            }))}
          />
        </div>
        {yards.length > TOP_YARDS && (
          <a
            href="#yards-title"
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            All {InventoryFormat.plural(yards.length, "yard", "yards")}, by
            state <ArrowDown className="size-3.5" aria-hidden="true" />
          </a>
        )}
      </section>

      {arrivals.length > 0 && (
        <section aria-labelledby="arrivals-title" className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
            <h2 id="arrivals-title" className="text-lg font-semibold">
              Newest arrivals
            </h2>
            <Link
              href={searchHref}
              prefetch={false}
              className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
            >
              All {InventoryFormat.count(model.count)} in search{" "}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
          <ul className="divide-y">
            {arrivals.map((vehicle) => {
              const yard = byKey.get(`${vehicle.source}:${vehicle.code}`);
              return (
                <VehicleRow
                  key={vehicle.vin}
                  vehicle={vehicle}
                  source={vehicle.source}
                  publishedAt={sourcePublishedAt[vehicle.source] ?? null}
                  yard={
                    yard && {
                      name: YardName.headline(yard.name, yard.operator),
                      href: yardHref(yard),
                      place: `${yard.city}, ${yard.state}`,
                    }
                  }
                />
              );
            })}
          </ul>
        </section>
      )}

      <AlertsCallout
        subject={`a new ${name} arrival shows up at any yard we track`}
        sourcePage="model"
      />

      {yards.length > TOP_YARDS && (
        <section aria-labelledby="yards-title" className="mt-10">
          <h2 id="yards-title" className="text-lg font-semibold">
            Every yard with one, by state
          </h2>
          <div className="mt-3 divide-y border-y">
            {YardPath.byRegion(routed).map(({ region, yards: regionYards }) => (
              <details key={region.slug} className="group">
                <summary className="hover:bg-muted/60 flex cursor-pointer list-none items-center justify-between gap-4 px-1 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1.5">
                    <ChevronRight
                      className="text-muted-foreground size-4 transition-transform group-open:rotate-90"
                      aria-hidden="true"
                    />
                    {region.name}
                  </span>
                  <span className="text-muted-foreground text-xs font-normal tabular-nums">
                    {InventoryFormat.plural(
                      regionYards.length,
                      "yard",
                      "yards",
                    )}
                  </span>
                </summary>
                <div className="pb-3">
                  <YardRows
                    rows={regionYards.map((yard) => {
                      const entry = yards.find(
                        (candidate) =>
                          candidate.yard.path.href === yard.path.href,
                      );
                      return {
                        href: yardHref(yard),
                        name: YardName.headline(yard.name, yard.operator),
                        place: yard.city,
                        figure: InventoryFormat.count(entry?.count ?? 0),
                        detail: entry?.years,
                      };
                    })}
                  />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {siblings.length > 0 && (
        <section aria-labelledby="siblings-title" className="mt-10">
          <h2 id="siblings-title" className="text-lg font-semibold">
            Other {make.name} models
          </h2>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {siblings.slice(0, SIBLINGS).map((sibling) => (
              <li key={sibling.key}>
                <Link
                  href={sibling.href}
                  prefetch={false}
                  className="hover:bg-muted block rounded-full border px-3 py-1 text-sm tabular-nums"
                >
                  {sibling.name}{" "}
                  <span className="text-muted-foreground">
                    {InventoryFormat.count(sibling.count)}
                  </span>
                </Link>
              </li>
            ))}
            <li>
              <Link
                href={make.href}
                prefetch={false}
                className="block px-2 py-1 text-sm font-medium underline-offset-4 hover:underline"
              >
                All {make.name} models
              </Link>
            </li>
          </ul>
        </section>
      )}
    </>
  );
}
