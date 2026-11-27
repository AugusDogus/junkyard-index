import type { DormantYard } from "~/lib/dormant-yard";
import type { HiddenSources } from "~/lib/hidden-source";
import { buildSearchUrl } from "~/lib/search-utils";
import { YardAddress } from "~/lib/yard-address";
import { YardService } from "~/lib/yard-service";
import { isIngestionSource } from "~/lib/ingestion-source";
import { ArrowUpRight, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { FreshnessBadge } from "~/components/inventory/FreshnessBadge";
import {
  InventoryStaleness,
  UNKNOWN_CHECK_LABEL,
} from "~/lib/inventory-staleness";
import { VehicleRow } from "~/components/inventory/VehicleRow";
import { AlertsCallout } from "~/components/junkyards/AlertsCallout";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { JsonLd } from "~/components/JsonLd";
import { Button } from "~/components/ui/button";
import { env } from "~/env";
import { InventoryFormat } from "~/lib/inventory-format";
import { MakeInventory } from "~/lib/make-inventory";
import { StructuredData, type Crumb } from "~/lib/structured-data";
import { cn } from "~/lib/utils";
import {
  YardInventory,
  type MakeCount,
  type YardInventoryPage,
  type YardNewArrivals,
} from "~/lib/yard-inventory";
import { YardName } from "~/lib/yard-name";
import {
  filterName,
  filterHref,
  type YardMakeFilter,
  type YardModelFilter,
} from "~/lib/yard-page-metadata";
export { yardPageMetadata, yardMakeMetadata } from "~/lib/yard-page-metadata";
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

export function YardInventoryView({
  yard,
  inventory,
  total,
  newArrivals,
  makes,
  makeSlugs,
  publishedAt,
  checkedAt,
  checkUnknown,
  lastArrivalAt,
  nearby,
  chain,
  filter,
  hiddenSources,
  dormant,
}: {
  yard: RoutedYard;
  inventory: YardInventoryPage;
  /** Vehicles in the yard, or of the filtered make. */
  total: number;
  /** Of those, the known arrivals this week, for the header and row badges. */
  newArrivals: YardNewArrivals;
  /** Every make in the yard, for narrowing. */
  makes: MakeCount[];
  /** Each make's national URL slug, by make key. */
  makeSlugs: ReadonlyMap<string, string>;
  publishedAt: string | null;
  /**
   * When the yard was last checked: its own publication, else its source's
   * (`InventoryStaleness.checkedAt`). Past 36 hours, the page and every row
   * say so; a source past 7 days is hidden, so its yard has no page.
   */
  checkedAt: string | null;
  /** No run has proven a live fetch of this yard: it reads UNKNOWN_CHECK_LABEL. */
  checkUnknown: boolean;
  /** The yard's newest first sighting (`yard_check.last_arrival_at`), if known. */
  lastArrivalAt: string | null;
  nearby: readonly NearbyYard[];
  /** The chain the yard belongs to, when it has other yards we track. */
  chain: { name: string; href: string; yards: number } | null;
  /** Sources hidden from the site; their rows link nowhere. */
  hiddenSources: HiddenSources;
  /** The make this page is narrowed to, if any. */
  filter: YardMakeFilter | YardModelFilter | null;
  /**
   * Why the yard shows no vehicles while it keeps its page, or null when it
   * is listed. A dormant yard's page lists none.
   */
  dormant: DormantYard | null;
}) {
  const headline = YardName.headline(yard.name, yard.operator);
  const service = isIngestionSource(yard.source)
    ? YardService.resolve(yard.source, yard.code).kind
    : "unknown";
  const serviceLabel = {
    self_service: "Self-service, bring tools",
    full_service: "Full-service, call first",
    both: "Self & full service",
    unknown: "Yard type unknown",
  }[service];
  const crumbs: Crumb[] = filter
    ? [
        ...yardCrumbs(yard),
        { name: filterName(filter), href: filterHref(yard, filter) },
      ]
    : yardCrumbs(yard);
  const shownFrom = inventory.firstIndex + 1;
  const shownTo = inventory.firstIndex + inventory.vehicles.length;
  const showMakes = inventory.page === 1 && makes.length > 1;
  const lastChecked = checkUnknown
    ? UNKNOWN_CHECK_LABEL
    : InventoryStaleness.label(checkedAt, Date.now());
  // Only a current check proves what the yard's list holds: next to "Last
  // checked" the missing arrivals may be our missed reads, not the yard's.
  // A dormant yard lists nothing, so it has no list to call stale.
  const noArrivals =
    lastChecked === null && !dormant
      ? YardInventory.noArrivalsLabel(lastArrivalAt, Date.now())
      : null;
  const newDisplay = YardInventory.newDisplay(newArrivals);
  // Nothing is "new" next to "Last checked": a stale yard's newest cars are
  // only new as of its last check.
  const headerCount = lastChecked === null ? newDisplay.headerCount : null;
  const badgesSince = InventoryStaleness.newBadgeReference(
    newDisplay.badgesSince,
    lastChecked,
  );

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
            filter
              ? `${filterName(filter)} at ${headline}`
              : `${headline} inventory`,
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
          <h1 className="text-display-s leading-[1.02] font-medium text-pretty">
            {filter ? `${filterName(filter)} at ${headline}` : headline}
          </h1>
          <p className="border-rule-strong bg-paper-2 text-ink mt-3 inline-block border px-2.5 py-1 text-sm font-medium">
            {serviceLabel}
          </p>
          {dormant ? (
            <p className="text-lead text-ink-2 mt-5 max-w-[48ch] leading-[1.45]">
              {dormantSummary(dormant)}
            </p>
          ) : (
            <p className="text-lead text-ink-2 mt-5 max-w-[48ch] leading-[1.45]">
              <span className="text-ink font-medium tabular-nums">
                {InventoryFormat.plural(
                  total,
                  filter ? `${filterName(filter)} vehicle` : "vehicle",
                  filter ? `${filterName(filter)} vehicles` : "vehicles",
                )}
              </span>{" "}
              in the yard in {yard.city}, {yard.state}
              {headerCount !== null && (
                <>
                  ,{" "}
                  <Link
                    className="text-signal font-medium tabular-nums underline underline-offset-4"
                    rel="nofollow"
                    href={buildSearchUrl(filter ? filterName(filter) : "", {
                      arrivalWindow: "7d",
                      salvageYards: [yard.name],
                      sources: [yard.source],
                      yardTypes: [],
                    })}
                  >
                    {InventoryFormat.count(headerCount)} new this week
                  </Link>
                </>
              )}
              .
            </p>
          )}
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
            className="text-section leading-[1.02] font-medium"
          >
            {inventory.page === 1
              ? "Newest first"
              : `Page ${inventory.page}, newest first`}
          </h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {!dormant && (
              <FreshnessBadge
                publishedAt={
                  publishedAt ?? (lastChecked === null ? null : checkedAt)
                }
              />
            )}
            {noArrivals !== null && (
              <p className="text-ink-2 text-sm text-pretty">{noArrivals}</p>
            )}
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
          <p className="border-rule-strong text-ink-2 mt-6 border-t pt-6 text-base">
            {dormant
              ? `${dormantSummary(dormant)} Check with the yard before you go.`
              : publishedAt === null
                ? "We couldn't confirm this yard's current inventory, so none is shown. Check the yard's website."
                : "The yard lists no vehicles right now."}
          </p>
        ) : (
          <ul className="border-t-rule-strong border-b-rule divide-rule mt-6 divide-y border-t border-b">
            {inventory.vehicles.map((vehicle) => (
              <VehicleRow
                key={vehicle.vin}
                vehicle={vehicle}
                source={yard.source}
                publishedAt={badgesSince}
                lastChecked={lastChecked}
                layout="columns"
                hiddenSources={hiddenSources}
              />
            ))}
          </ul>
        )}
        <Pagination
          inventory={inventory}
          pageHref={(page) =>
            filter && !("model" in filter)
              ? YardPath.makePageHref(yard.path, filter.slug, page)
              : YardPath.pageHref(yard.path, page)
          }
        />
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
                ? `a ${filterName(filter)} you're after shows up here or at any other yard we track`
                : `a matching vehicle shows up at ${headline} or any other yard we track`
            }
            sourcePage="yard"
          />
        </div>
      )}

      {/* Nearby yards on the board: distance is the figure, in the figure colour. */}
      {nearby.length > 0 && (
        <section
          aria-labelledby="nearby-title"
          className="bg-board text-board-ink border-rule-strong mt-(--section-gap-s) border px-4 py-8 sm:p-8 lg:p-10"
        >
          <h2
            id="nearby-title"
            className="text-section leading-[1.02] font-medium"
          >
            Other yards near {yard.city}
          </h2>
          <ul className="border-board-rule mt-(--space-xl) gap-x-10 border-t md:columns-2">
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
                    <span className="block text-[0.9375rem] leading-snug font-medium">
                      {YardName.headline(other.name, other.operator)}
                    </span>
                    <span className="text-board-muted mt-0.5 block text-sm">
                      {other.city}, {other.state}
                    </span>
                  </span>
                  <span className="text-board-muted shrink-0 text-right text-sm tabular-nums">
                    <span className="whitespace-nowrap">
                      <span className="text-figure text-title leading-none font-medium">
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

/** What a dormant yard's page says in place of its vehicle count. */
function dormantSummary(dormant: DormantYard): string {
  const since = InventoryFormat.date(dormant.since);
  return dormant.kind === "unconfirmed"
    ? `We couldn't confirm this yard's inventory after ${since}, so none is shown.`
    : `The yard has listed no vehicles since ${since}.`;
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
  const street = YardAddress.format(yard);
  return (
    <div className="sm:border-rule-strong sm:bg-paper-3 sm:border sm:p-6 lg:col-span-5 xl:col-span-4">
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
            className="active:bg-paper-2"
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
      "board-step border-rule-strong -mt-px -ml-px flex h-11 items-center gap-2 border px-3 text-sm whitespace-nowrap tabular-nums outline-none focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-focus sm:h-10",
      active
        ? "bg-ink text-paper font-medium"
        : "hover:bg-paper-2 active:bg-paper-2 text-ink",
    );
  return (
    <nav aria-label="Narrow by make">
      {/* One scrolling row on phones, so the list starts on the first
      screen; wrapped rows where there is room. */}
      <ul className="-mx-4 flex overflow-x-auto px-4 pt-1.5 pb-1 pl-[calc(1rem+1px)] [scrollbar-width:thin] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:py-0 sm:pt-px sm:pr-0 sm:pl-px">
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

/** Links to every page of the list; `pageHref` gives each page's URL. */
function Pagination({
  inventory,
  pageHref,
}: {
  inventory: YardInventoryPage;
  pageHref: (page: number) => string;
}) {
  if (inventory.pageCount <= 1) return null;
  const pages = Array.from({ length: inventory.pageCount }, (_, i) => i + 1);
  const cell =
    "border-rule-strong -mt-px -ml-px inline-flex size-11 items-center justify-center border text-sm tabular-nums";
  return (
    <nav aria-label="Inventory pages" className="mt-8">
      <ul className="flex flex-wrap pt-px pl-px">
        {pages.map((page) => (
          <li key={page}>
            {page === inventory.page ? (
              <span
                aria-current="page"
                className={cn(cell, "bg-ink text-paper font-medium")}
              >
                {page}
              </span>
            ) : (
              <Link
                href={pageHref(page)}
                prefetch={false}
                className={cn(
                  cell,
                  "board-step text-ink hover:bg-paper-2 active:bg-paper-2 focus-visible:outline-focus outline-none focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid",
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
