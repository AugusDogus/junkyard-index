import { ArrowRight, ArrowUpRight, MapPin, Phone } from "lucide-react";
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

      <header className="pb-6">
        {chain && (
          <Link
            href={chain.href}
            prefetch={false}
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
          >
            {chain.name} · {InventoryFormat.count(chain.yards)} yards we track
          </Link>
        )}
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {filter ? `${filter.name} at ${headline}` : headline}
        </h1>
        <p className="mt-3 text-base text-pretty">
          <span className="font-semibold tabular-nums">
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
              <span className="font-semibold tabular-nums">
                {InventoryFormat.count(newCount)} new
              </span>{" "}
              this week
            </>
          )}
          .
        </p>
        <div className="mt-2">
          <FreshnessBadge publishedAt={publishedAt} />
        </div>
        <YardContact yard={yard} />
      </header>

      {showMakes && (
        <MakeChips
          yard={yard}
          makes={makes}
          makeSlugs={makeSlugs}
          selected={filter?.slug ?? null}
        />
      )}

      <section aria-labelledby="vehicles-title" className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3">
          <h2 id="vehicles-title" className="text-lg font-semibold">
            {inventory.page === 1
              ? "Newest first"
              : `Page ${inventory.page}, newest first`}
          </h2>
          {total > 0 && (
            <p className="text-muted-foreground text-sm tabular-nums">
              {InventoryFormat.count(shownFrom)}–
              {InventoryFormat.count(shownTo)} of {InventoryFormat.count(total)}
            </p>
          )}
        </div>
        {total === 0 ? (
          <p className="text-muted-foreground mt-4 text-sm">
            {publishedAt === null
              ? "We couldn't confirm this yard's current inventory, so none is shown. Check the yard's website."
              : "The yard lists no vehicles right now."}
          </p>
        ) : (
          <ul className="divide-y">
            {inventory.vehicles.map((vehicle) => (
              <VehicleRow
                key={vehicle.vin}
                vehicle={vehicle}
                source={yard.source}
                publishedAt={newSince}
              />
            ))}
          </ul>
        )}
        <Pagination yard={yard} inventory={inventory} />
        <p className="text-muted-foreground mt-4 text-xs text-pretty">
          Listings come from the yard. Vehicles can be crushed or picked over
          between updates, so confirm with the yard before you go. We list whole
          vehicles, not individual parts.
        </p>
        {filter && (
          <p className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <Link
              href={yard.path.href}
              prefetch={false}
              className="font-medium underline-offset-4 hover:underline"
            >
              All {InventoryFormat.count(yard.vehicleCount)} vehicles at this
              yard
            </Link>
            <Link
              href={MakeInventory.makeHref(filter.slug)}
              prefetch={false}
              className="inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline"
            >
              {filter.name} at every yard{" "}
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
          </p>
        )}
      </section>

      {inventory.page === 1 && (
        <AlertsCallout
          subject={
            filter
              ? `a ${filter.name} you're after shows up here or at any other yard we track`
              : `a matching vehicle shows up at ${headline} or any other yard we track`
          }
          sourcePage="yard"
        />
      )}

      {nearby.length > 0 && (
        <section aria-labelledby="nearby-title" className="mt-10">
          <h2 id="nearby-title" className="text-lg font-semibold">
            Other yards near {yard.city}
          </h2>
          <ul className="mt-3 divide-y border-y">
            {nearby.map(({ yard: other, miles }) => (
              <li key={other.path.href}>
                <Link
                  href={other.path.href}
                  prefetch={false}
                  className="hover:bg-muted/60 flex items-baseline justify-between gap-4 px-1 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {YardName.headline(other.name, other.operator)}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {other.city}, {other.state}
                    </span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-right text-xs tabular-nums">
                    {InventoryFormat.count(Math.round(miles))} mi
                    <span className="block">
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

function YardContact({ yard }: { yard: RoutedYard }) {
  const phoneHref = yardPhoneHref(yard.phone);
  const street = [yard.address, `${yard.city}, ${yard.state}`, yard.postalCode]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="mt-4 flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:items-center">
      <address className="text-muted-foreground flex items-start gap-1.5 not-italic">
        <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {street}
      </address>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <a href={yard.mapsUrl} target="_blank" rel="noopener noreferrer">
            Directions
            <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
          </a>
        </Button>
        {phoneHref && (
          <Button asChild variant="outline" size="sm">
            <a href={phoneHref}>
              <Phone aria-hidden="true" data-icon="inline-start" />
              {yard.phone}
            </a>
          </Button>
        )}
        {yard.website && (
          <Button asChild variant="outline" size="sm">
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
    </div>
  );
}

/**
 * Narrows the yard's inventory to one make, staying at this yard. Every make
 * is listed: one scrolling row on phones, wrapped rows on wider screens.
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
  const chip = (active: boolean) =>
    cn(
      "block rounded-full border px-3 py-1 text-sm whitespace-nowrap tabular-nums transition-colors",
      active
        ? "bg-foreground text-background border-foreground"
        : "hover:bg-muted",
    );
  return (
    <nav aria-label="Narrow by make">
      {/* One scrolling row on phones, so the list starts on the first
      screen; wrapped rows where there is room. */}
      <ul className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
        <li className="shrink-0">
          <Link
            href={yard.path.href}
            prefetch={false}
            aria-current={selected === null ? "page" : undefined}
            className={chip(selected === null)}
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
              className={chip(selected === make.slug)}
            >
              {make.make}{" "}
              <span
                className={
                  selected === make.slug
                    ? "opacity-70"
                    : "text-muted-foreground"
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
  return (
    <nav aria-label="Inventory pages" className="mt-4">
      <ul className="flex flex-wrap gap-1.5">
        {pages.map((page) => (
          <li key={page}>
            {page === inventory.page ? (
              <span
                aria-current="page"
                className="bg-foreground text-background inline-flex size-9 items-center justify-center rounded-md text-sm tabular-nums"
              >
                {page}
              </span>
            ) : (
              <Link
                href={YardPath.pageHref(yard.path, page)}
                prefetch={false}
                className="hover:bg-muted inline-flex size-9 items-center justify-center rounded-md border text-sm tabular-nums"
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
