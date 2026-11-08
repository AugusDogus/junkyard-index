import { ArrowUpRight, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FreshnessBadge } from "~/components/inventory/FreshnessBadge";
import { VehicleRow } from "~/components/inventory/VehicleRow";
import { AlertsCallout } from "~/components/junkyards/AlertsCallout";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { JsonLd } from "~/components/JsonLd";
import { Button } from "~/components/ui/button";
import { env } from "~/env";
import { InventoryFormat } from "~/lib/inventory-format";
import { MakeInventory } from "~/lib/make-inventory";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData, type Crumb } from "~/lib/structured-data";
import { cn } from "~/lib/utils";
import type { MakeCount, YardInventoryPage } from "~/lib/yard-inventory";
import { YardName } from "~/lib/yard-name";
import { YardPath } from "~/lib/yard-path";
import { yardPhoneHref } from "~/lib/yard-phone";
import type { RoutedYard } from "~/server/yard-inventory";

export function yardCrumbs(yard: RoutedYard): Crumb[] {
  return [
    { name: "Home", href: "/" },
    { name: "Junkyards", href: "/junkyards" },
    {
      name: yard.path.region.name,
      href: YardPath.regionHref(yard.path.region),
    },
    { name: YardName.headline(yard.name, yard.operator), href: yard.path.href },
  ];
}

export type NearbyYard = { yard: RoutedYard; miles: number };

/** A make the page is narrowed to, by its national name and slug. */
export type YardMakeFilter = { name: string; slug: string };

/** Title, description, and canonical URL for page `page` of a yard. */
export function yardPageMetadata(
  yard: RoutedYard,
  total: number,
  publishedAt: string | null,
  page: number,
): Metadata {
  const headline = YardName.headline(yard.name, yard.operator);
  const place = `${yard.city}, ${yard.state}`;
  const title =
    page === 1
      ? `${headline} Inventory | ${place}`
      : `${headline} Inventory, Page ${page} | ${place}`;
  const description = `${InventoryFormat.plural(total, "vehicle", "vehicles")} at ${headline} in ${place}, with the year, make, model, and VIN of each.${
    publishedAt ? ` Updated ${InventoryFormat.date(publishedAt)}.` : ""
  }`;
  const url = YardPath.pageHref(yard.path, page);
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { ...SITE_OPEN_GRAPH, type: "website", url, title, description },
    twitter: { card: "summary", title, description },
  };
}

// Fewer vehicles than this and a yard's page for one make stays out of
// search: too thin to be worth a result of its own.
const YARD_MAKE_INDEXABLE_MINIMUM = 5;

/** Title, description, and canonical URL for one make at a yard. */
export function yardMakeMetadata(
  yard: RoutedYard,
  make: YardMakeFilter,
  total: number,
  publishedAt: string | null,
): Metadata {
  const headline = YardName.headline(yard.name, yard.operator);
  const place = `${yard.city}, ${yard.state}`;
  const title = `${make.name} at ${headline} | ${place}`;
  const description = `${InventoryFormat.plural(total, `${make.name} vehicle`, `${make.name} vehicles`)} at ${headline} in ${place}, with where each one sits in the yard.${
    publishedAt ? ` Updated ${InventoryFormat.date(publishedAt)}.` : ""
  }`;
  const url = YardPath.makeHref(yard.path, make.slug);
  return {
    title,
    description,
    alternates: { canonical: url },
    robots:
      total < YARD_MAKE_INDEXABLE_MINIMUM
        ? { index: false, follow: true }
        : undefined,
    openGraph: { ...SITE_OPEN_GRAPH, type: "website", url, title, description },
    twitter: { card: "summary", title, description },
  };
}

export function YardInventoryView({
  yard,
  inventory,
  total,
  newCount,
  newIsMeaningful,
  makes,
  makeSlugs,
  publishedAt,
  nearby,
  chain,
  filter,
}: {
  yard: RoutedYard;
  inventory: YardInventoryPage;
  /** Vehicles in the yard, or of the filtered make. */
  total: number;
  /** Of those, how many arrived in the week before the latest update. */
  newCount: number;
  /**
   * Whether "new" means anything at this yard, judged from the whole yard
   * (see `YardInventory.newIsMeaningful`), even on a page for one make.
   */
  newIsMeaningful: boolean;
  /** Every make in the yard, for narrowing. */
  makes: MakeCount[];
  /** Each make's national URL slug, by make key. */
  makeSlugs: ReadonlyMap<string, string>;
  publishedAt: string | null;
  nearby: readonly NearbyYard[];
  /** The chain the yard belongs to, when it has other yards we track. */
  chain: { name: string; href: string; yards: number } | null;
  /** The make this page is narrowed to, if any. */
  filter: YardMakeFilter | null;
}) {
  const headline = YardName.headline(yard.name, yard.operator);
  const crumbs: Crumb[] = filter
    ? [
        ...yardCrumbs(yard),
        { name: filter.name, href: YardPath.makeHref(yard.path, filter.slug) },
      ]
    : yardCrumbs(yard);
  const shownFrom = inventory.firstIndex + 1;
  const shownTo = inventory.firstIndex + inventory.vehicles.length;
  const showMakes = inventory.page === 1 && makes.length > 1;
  // A newly tracked yard is all "new"; say nothing rather than that.
  const newSince = newIsMeaningful ? publishedAt : null;

  return (
    <>
      <JsonLd
        nodes={[
          StructuredData.breadcrumbs(env.NEXT_PUBLIC_APP_URL, crumbs),
          StructuredData.yard(env.NEXT_PUBLIC_APP_URL, yard.path.href, {
            ...yard,
            name: headline,
            country: yard.path.region.country,
          }),
          StructuredData.vehicles(
            filter ? `${filter.name} at ${headline}` : `${headline} inventory`,
            total,
            inventory.firstIndex,
            inventory.vehicles,
          ),
        ]}
      />
      <Breadcrumbs crumbs={crumbs} />

      <header className="grid gap-x-8 gap-y-8 lg:grid-cols-12 lg:items-start">
        <div className="lg:col-span-7 xl:col-span-8">
          {/* Pretty, not balanced: balancing breaks names like PICK-n-PULL
          at their hyphens. */}
          <h1 className="text-display-s leading-[1.02] font-extrabold text-pretty">
            {filter ? `${filter.name} at ${headline}` : headline}
          </h1>
          <p className="text-lead text-ink-2 mt-5 max-w-[48ch] leading-[1.45]">
            <span className="text-ink font-extrabold tabular-nums">
              {InventoryFormat.plural(
                total,
                filter ? `${filter.name} vehicle` : "vehicle",
                filter ? `${filter.name} vehicles` : "vehicles",
              )}
            </span>{" "}
            in the yard in {yard.city}, {yard.state}
            {newIsMeaningful && newCount > 0 && (
              <>
                ,{" "}
                <span className="text-signal font-extrabold tabular-nums">
                  {InventoryFormat.count(newCount)} new
                </span>{" "}
                this week
              </>
            )}
            .
          </p>
        </div>
        <YardContact yard={yard} chain={chain} />
      </header>

      <section
        aria-labelledby="vehicles-title"
        className="mt-(--space-2xl) lg:mt-(--space-3xl)"
      >
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <h2
            id="vehicles-title"
            className="text-section leading-[1.02] font-extrabold"
          >
            {inventory.page === 1
              ? "Newest first"
              : `Page ${inventory.page}, newest first`}
          </h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <FreshnessBadge publishedAt={publishedAt} />
            {total > 0 && (
              <p className="text-ink text-sm font-medium tabular-nums">
                {InventoryFormat.count(shownFrom)} to{" "}
                {InventoryFormat.count(shownTo)} of{" "}
                {InventoryFormat.count(total)}
              </p>
            )}
          </div>
        </div>
        {showMakes && (
          <div className="mt-5">
            <MakeChips
              yard={yard}
              makes={makes}
              makeSlugs={makeSlugs}
              selected={filter?.slug ?? null}
            />
          </div>
        )}
        {total === 0 ? (
          <p className="border-ink text-ink-2 mt-6 border-t-2 pt-6 text-base">
            {publishedAt === null
              ? "We couldn't confirm this yard's current inventory, so none is shown. Check the yard's website."
              : "The yard lists no vehicles right now."}
          </p>
        ) : (
          <ul className="border-t-ink border-b-rule divide-rule mt-6 divide-y border-t-2 border-b">
            {inventory.vehicles.map((vehicle) => (
              <VehicleRow
                key={vehicle.vin}
                vehicle={vehicle}
                source={yard.source}
                publishedAt={newSince}
                layout="columns"
              />
            ))}
          </ul>
        )}
        <Pagination yard={yard} inventory={inventory} />
        <div className="mt-8 grid gap-y-4 lg:grid-cols-12 lg:gap-x-8">
          <p className="text-ink-2 max-w-[65ch] text-sm leading-relaxed text-pretty lg:col-span-7">
            Listings come from the yard. Vehicles can be crushed or picked over
            between updates, so confirm with the yard before you go. We list
            whole vehicles, not individual parts.
          </p>
          {filter && (
            <p className="flex flex-col items-start gap-y-2 text-[0.9375rem] lg:col-span-5 lg:items-end">
              <Link
                href={yard.path.href}
                prefetch={false}
                className={`${LINK} font-medium`}
              >
                All {InventoryFormat.count(yard.vehicleCount)} vehicles at this
                yard
              </Link>
              <Link
                href={MakeInventory.makeHref(filter.slug)}
                prefetch={false}
                className={`${LINK} font-medium`}
              >
                {filter.name} at every yard
              </Link>
            </p>
          )}
        </div>
      </section>

      {inventory.page === 1 && (
        <div className="mt-(--section-gap-s)">
          <AlertsCallout
            subject={
              filter
                ? `a ${filter.name} you're after shows up here or at any other yard we track`
                : `a matching vehicle shows up at ${headline} or any other yard we track`
            }
            sourcePage="yard"
          />
        </div>
      )}

      {/* Nearby yards on the board: distance is the figure, in amber. */}
      {nearby.length > 0 && (
        <section
          aria-labelledby="nearby-title"
          className="bg-board text-board-ink border-ink mt-(--section-gap-s) border-2 px-4 py-8 sm:p-8 lg:p-10"
        >
          <h2
            id="nearby-title"
            className="text-section leading-[1.02] font-extrabold"
          >
            Other yards near {yard.city}
          </h2>
          <ul className="border-board-ink mt-(--space-xl) gap-x-10 border-t-2 md:columns-2">
            {nearby.map(({ yard: other, miles }) => (
              <li
                key={other.path.href}
                className="border-board-rule break-inside-avoid border-b"
              >
                <Link
                  href={other.path.href}
                  prefetch={false}
                  className="board-step hover:bg-board-2 active:bg-board-2 focus-visible:outline-figure flex items-center justify-between gap-6 px-2 py-4 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
                >
                  <span className="min-w-0">
                    <span className="block text-[0.9375rem] leading-snug font-extrabold">
                      {YardName.headline(other.name, other.operator)}
                    </span>
                    <span className="text-board-muted mt-0.5 block text-sm">
                      {other.city}, {other.state}
                    </span>
                  </span>
                  <span className="text-board-muted shrink-0 text-right text-sm tabular-nums">
                    <span className="whitespace-nowrap">
                      <span className="text-figure text-title leading-none font-extrabold">
                        {InventoryFormat.count(Math.round(miles))}
                      </span>{" "}
                      mi
                    </span>
                    <span className="mt-1 block">
                      {InventoryFormat.plural(
                        other.vehicleCount,
                        "vehicle",
                        "vehicles",
                      )}
                    </span>
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

const LINK =
  "board-step text-ink hover:text-signal active:text-ink focus-visible:outline-focus underline decoration-1 underline-offset-[0.3em] outline-none hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid";

/** The yard's facts as a plate: where it is, how to reach it, who runs it. */
function YardContact({
  yard,
  chain,
}: {
  yard: RoutedYard;
  chain: { name: string; href: string; yards: number } | null;
}) {
  const phoneHref = yardPhoneHref(yard.phone);
  const street = [yard.address, `${yard.city}, ${yard.state}`, yard.postalCode]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="sm:border-ink sm:bg-paper-3 sm:border-2 sm:p-6 lg:col-span-5 xl:col-span-4">
      <address className="text-ink flex items-start gap-2.5 text-[0.9375rem] leading-snug not-italic">
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {street}
      </address>
      {phoneHref && (
        <a
          href={phoneHref}
          className={`${LINK} mt-3 inline-flex min-h-6 items-center gap-2.5 text-[0.9375rem] tabular-nums`}
        >
          <Phone className="size-4 shrink-0" aria-hidden="true" />
          {yard.phone}
        </a>
      )}
      <div className="mt-3 flex flex-wrap gap-3 sm:mt-5">
        <Button asChild size="xl">
          <a href={yard.mapsUrl} target="_blank" rel="noopener noreferrer">
            Directions
            <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
          </a>
        </Button>
        {yard.website && (
          <Button
            asChild
            variant="outline"
            size="xl"
            className="active:bg-ink active:text-paper"
          >
            <a
              href={yard.website.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {yard.website.kind === "provider"
                ? "Chain website"
                : "Yard website"}
              <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
            </a>
          </Button>
        )}
      </div>
      {chain && (
        <p className="border-rule text-ink-2 mt-3 border-t pt-3 text-[0.8125rem] sm:mt-5 sm:pt-4 sm:text-sm">
          <Link href={chain.href} prefetch={false} className={LINK}>
            {chain.name}, {InventoryFormat.count(chain.yards)} yards we track
          </Link>
        </p>
      )}
    </div>
  );
}

/**
 * Narrows the yard's inventory to one make, staying at this yard. Every make
 * is listed as a choice set of square cells sharing their borders: one
 * scrolling row on phones, wrapped rows on wider screens.
 */
function MakeChips({
  yard,
  makes,
  makeSlugs,
  selected,
}: {
  yard: RoutedYard;
  makes: readonly MakeCount[];
  makeSlugs: ReadonlyMap<string, string>;
  selected: string | null;
}) {
  const linked = makes.flatMap((make) => {
    const slug = makeSlugs.get(make.key);
    return slug ? [{ ...make, slug }] : [];
  });
  const cell = (active: boolean) =>
    cn(
      "board-step border-ink -mt-0.5 -ml-0.5 flex h-11 items-center gap-2 border-2 px-3 text-sm whitespace-nowrap tabular-nums outline-none focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus sm:h-10",
      active
        ? "bg-ink text-paper font-extrabold"
        : "hover:bg-paper-2 active:bg-ink active:text-paper text-ink",
    );
  return (
    <nav aria-label="Narrow by make">
      {/* One scrolling row on phones, so the list starts on the first
      screen; wrapped rows where there is room. */}
      <ul className="-mx-4 flex overflow-x-auto px-4 pt-1.5 pb-1 pl-[calc(1rem+2px)] [scrollbar-width:thin] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:py-0 sm:pt-0.5 sm:pr-0 sm:pl-0.5">
        <li className="shrink-0">
          <Link
            href={yard.path.href}
            prefetch={false}
            aria-current={selected === null ? "page" : undefined}
            className={cell(selected === null)}
          >
            All makes
          </Link>
        </li>
        {linked.map((make) => (
          <li key={make.key} className="shrink-0">
            <Link
              href={YardPath.makeHref(yard.path, make.slug)}
              prefetch={false}
              aria-current={selected === make.slug ? "page" : undefined}
              className={cell(selected === make.slug)}
            >
              {make.make}
              <span
                className={
                  selected === make.slug ? "font-medium" : "text-ink-3"
                }
              >
                {make.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Pagination({
  yard,
  inventory,
}: {
  yard: RoutedYard;
  inventory: YardInventoryPage;
}) {
  if (inventory.pageCount <= 1) return null;
  const pages = Array.from({ length: inventory.pageCount }, (_, i) => i + 1);
  const cell =
    "border-ink -mt-0.5 -ml-0.5 inline-flex size-11 items-center justify-center border-2 text-sm tabular-nums";
  return (
    <nav aria-label="Inventory pages" className="mt-8">
      <ul className="flex flex-wrap pt-0.5 pl-0.5">
        {pages.map((page) => (
          <li key={page}>
            {page === inventory.page ? (
              <span
                aria-current="page"
                className={cn(cell, "bg-ink text-paper font-extrabold")}
              >
                {page}
              </span>
            ) : (
              <Link
                href={YardPath.pageHref(yard.path, page)}
                prefetch={false}
                className={cn(
                  cell,
                  "board-step text-ink hover:bg-paper-2 active:bg-ink active:text-paper focus-visible:outline-focus outline-none focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid",
                )}
              >
                <span className="sr-only">Page </span>
                {page}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
