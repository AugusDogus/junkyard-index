import { Minus, Plus, Search } from "lucide-react";
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

/** An underlined text link on the paper: ink, cobalt on hover. */
const INLINE_LINK =
  "board-step text-ink hover:text-signal focus-visible:outline-focus inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-medium underline decoration-1 underline-offset-[0.3em] outline-none hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid";

/** Up to four columns, fewer for a short list, so no column holds a lone row. */
function siblingColumns(count: number): string {
  if (count >= 12) return "columns-2 lg:columns-4";
  if (count >= 9) return "columns-2 lg:columns-3";
  if (count >= 4) return "columns-2";
  return "max-w-2xl";
}

/** A list split in two, the first half one longer when the count is odd. */
function halves<Item>(items: readonly Item[]): [Item[], Item[]] {
  const middle = Math.ceil(items.length / 2);
  return [items.slice(0, middle), items.slice(middle)];
}

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
  const shown = siblings.slice(0, SIBLINGS);

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
        <h1 className="text-display-s leading-[1.02] font-extrabold">
          {name} at junkyards
        </h1>
        <p className="text-lead text-ink-2 mt-5 max-w-[60ch] leading-[1.45]">
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.count(model.count)}
          </span>{" "}
          in stock at{" "}
          <span className="text-ink font-extrabold tabular-nums">
            {InventoryFormat.plural(yards.length, "yard", "yards")}
          </span>{" "}
          in {regionLabel(routed)}, model years {InventoryFormat.years(model)}.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
          <Button asChild size="xl" className="max-w-full">
            <Link href={searchHref} prefetch={false}>
              <Search aria-hidden="true" data-icon="inline-start" />
              <span className="truncate">Search every {name}</span>
            </Link>
          </Button>
          <FreshnessBadge publishedAt={freshness.latest} coverage={freshness} />
        </div>
      </header>

      {/* Where to go: the yards holding the most, on the board. */}
      <section
        aria-labelledby="top-yards-title"
        className="bg-board text-board-ink border-ink mt-(--space-2xl) border-2 px-4 py-8 sm:p-8 lg:mt-(--space-3xl) lg:p-10"
      >
        <h2
          id="top-yards-title"
          className="text-section leading-[1.02] font-extrabold"
        >
          Yards with the most
        </h2>
        <div className="mt-(--space-xl)">
          <YardRows
            tone="board"
            columns={2}
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
            className="board-step text-board-ink focus-visible:outline-figure mt-6 inline-flex min-h-11 items-center gap-2 text-[0.9375rem] font-medium underline decoration-1 underline-offset-[0.3em] outline-none hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid"
          >
            All {InventoryFormat.plural(yards.length, "yard", "yards")}, by
            state
          </a>
        )}
      </section>

      {arrivals.length > 0 && (
        <section
          aria-labelledby="arrivals-title"
          className="mt-(--section-gap) grid gap-y-(--space-xl) lg:grid-cols-12 lg:gap-x-8"
        >
          <div className="lg:sticky lg:top-28 lg:col-span-4 lg:self-start">
            <h2
              id="arrivals-title"
              className="text-section leading-[1.02] font-extrabold"
            >
              Newest arrivals
            </h2>
            <Link
              href={searchHref}
              prefetch={false}
              className={`${INLINE_LINK} mt-5`}
            >
              All {InventoryFormat.count(model.count)} in search
            </Link>
          </div>
          <ul className="border-ink divide-rule divide-y border-t-2 lg:col-span-8">
            {arrivals.map((vehicle) => {
              const yard = byKey.get(`${vehicle.source}:${vehicle.code}`);
              return (
                <VehicleRow
                  key={vehicle.vin}
                  vehicle={vehicle}
                  source={vehicle.source}
                  publishedAt={sourcePublishedAt[vehicle.source] ?? null}
                  layout="stacked"
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

      <div className="mt-(--space-2xl) lg:mt-(--section-gap-s)">
        <AlertsCallout
          subject={`a new ${name} arrival shows up at any yard we track`}
          sourcePage="model"
        />
      </div>

      {yards.length > TOP_YARDS && (
        <section aria-labelledby="yards-title" className="mt-(--section-gap-s)">
          <h2
            id="yards-title"
            className="text-section leading-[1.02] font-extrabold"
          >
            Every yard with one, by state
          </h2>
          {/* Two independent runs of states, so opening one never moves the other. */}
          <div className="border-ink mt-(--space-xl) grid items-start gap-x-10 border-t-2 lg:grid-cols-2">
            {halves(YardPath.byRegion(routed)).map((half, index) => (
              <div key={index}>
                {half.map(({ region, yards: regionYards }) => (
                  <details
                    key={region.slug}
                    className="group border-rule border-b"
                  >
                    <summary className="board-step hover:text-signal focus-visible:outline-focus flex list-none items-center gap-4 px-2 py-3 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0 flex-1 text-[0.9375rem] font-medium">
                        {region.name}
                      </span>
                      <span className="text-ink-3 text-sm tabular-nums">
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
                    </summary>
                    <div className="pb-4">
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
            ))}
          </div>
        </section>
      )}

      {siblings.length > 0 && (
        <section
          aria-labelledby="siblings-title"
          className="mt-(--section-gap)"
        >
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <h2
              id="siblings-title"
              className="text-section leading-[1.02] font-extrabold"
            >
              Other {make.name} models
            </h2>
            <Link href={make.href} prefetch={false} className={INLINE_LINK}>
              All {make.name} models
            </Link>
          </div>
          <ul
            className={`border-ink mt-(--space-xl) gap-x-8 border-t-2 ${siblingColumns(shown.length)}`}
          >
            {shown.map((sibling) => (
              <li
                key={sibling.key}
                className="border-rule break-inside-avoid border-b"
              >
                <Link
                  href={sibling.href}
                  prefetch={false}
                  className="board-step hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus flex items-baseline justify-between gap-3 px-2 py-3 text-[0.9375rem] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
                >
                  <span className="min-w-0 font-medium text-pretty">
                    {sibling.name}
                  </span>
                  <span className="shrink-0 font-extrabold tabular-nums">
                    {InventoryFormat.count(sibling.count)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
