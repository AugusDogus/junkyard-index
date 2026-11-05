import { ArrowUpRight, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { JsonLd } from "~/components/JsonLd";
import { AlertsCallout } from "~/components/junkyards/AlertsCallout";
import { Button } from "~/components/ui/button";
import { env } from "~/env";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData, type Crumb } from "~/lib/structured-data";
import { VehicleDestination } from "~/lib/vehicle-destination";
import wsrvLoader from "~/lib/wsrvLoader";
import {
  YardInventory,
  type MakeCount,
  type YardInventoryPage,
  type YardVehicle,
} from "~/lib/yard-inventory";
import { YardName } from "~/lib/yard-name";
import { YardPath } from "~/lib/yard-path";
import { yardPhoneHref } from "~/lib/yard-phone";
import { isIngestionSource } from "~/lib/ingestion-source";
import type { RoutedYard } from "~/server/yard-inventory";
import { InventoryFormat } from "~/lib/inventory-format";

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

export function YardInventoryView({
  yard,
  inventory,
  total,
  makes,
  makeHrefs,
  publishedAt,
  nearby,
  chain,
}: {
  yard: RoutedYard;
  inventory: YardInventoryPage;
  total: number;
  makes: MakeCount[];
  /** Each make's national page, by make key. */
  makeHrefs: ReadonlyMap<string, string>;
  publishedAt: string | null;
  nearby: readonly NearbyYard[];
  /** The chain the yard belongs to, when it has other yards we track. */
  chain: { name: string; href: string; yards: number } | null;
}) {
  const crumbs = yardCrumbs(yard);
  const headline = YardName.headline(yard.name, yard.operator);
  const first = inventory.page === 1;
  const shownFrom = inventory.firstIndex + 1;
  const shownTo = inventory.firstIndex + inventory.vehicles.length;

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
            `${headline} inventory`,
            total,
            inventory.firstIndex,
            inventory.vehicles,
          ),
        ]}
      />
      <Breadcrumbs crumbs={crumbs} />

      <header className="border-b pb-6">
        <p className="text-muted-foreground text-sm">
          {chain ? (
            <Link
              href={chain.href}
              prefetch={false}
              className="hover:text-foreground underline-offset-4 hover:underline"
            >
              One of the {InventoryFormat.count(chain.yards)} {chain.name} yards
              we track
            </Link>
          ) : (
            <>
              Salvage yard
              {yard.operator && !headline.includes(yard.operator)
                ? ` run by ${yard.operator}`
                : ""}
            </>
          )}
        </p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {headline} inventory
        </h1>
        <p className="mt-3 text-base text-pretty">
          <span className="font-medium tabular-nums">
            {InventoryFormat.plural(total, "vehicle", "vehicles")}
          </span>{" "}
          in the yard in {yard.city}, {yard.state}.{" "}
          <Freshness publishedAt={publishedAt} />
        </p>
        <YardContact yard={yard} />
      </header>

      {first && makes.length > 0 && (
        <MakeSummary makes={makes} hrefs={makeHrefs} />
      )}

      <section aria-labelledby="vehicles-title" className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="vehicles-title" className="text-xl font-semibold">
            {first ? "Newest arrivals first" : `Page ${inventory.page}`}
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
            This yard has no vehicles listed right now.
          </p>
        ) : (
          <ul className="mt-4 divide-y rounded-lg border">
            {inventory.vehicles.map((vehicle) => (
              <VehicleRow
                key={vehicle.vin}
                vehicle={vehicle}
                source={yard.source}
              />
            ))}
          </ul>
        )}
        <Pagination yard={yard} inventory={inventory} />
        <p className="text-muted-foreground mt-3 text-xs text-pretty">
          Listings come from the yard. Vehicles can be crushed or picked over
          between updates, so confirm with the yard before you go. We list whole
          vehicles, not individual parts.
        </p>
      </section>

      {first && (
        <AlertsCallout
          subject={`a matching vehicle shows up at ${headline} or any other yard we track`}
          sourcePage="yard"
        />
      )}

      {nearby.length > 0 && (
        <section aria-labelledby="nearby-title" className="mt-10">
          <h2 id="nearby-title" className="text-xl font-semibold">
            Other yards near {yard.city}
          </h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {nearby.map(({ yard: other, miles }) => (
              <li key={other.path.href}>
                <Link
                  href={other.path.href}
                  prefetch={false}
                  className="hover:bg-muted block rounded-lg border p-3"
                >
                  <span className="block text-sm font-medium">
                    {YardName.headline(other.name, other.operator)}
                  </span>
                  <span className="text-muted-foreground mt-1 block text-xs tabular-nums">
                    {other.city}, {other.state} ·{" "}
                    {InventoryFormat.count(Math.round(miles))} mi ·{" "}
                    {InventoryFormat.plural(
                      other.vehicleCount,
                      "vehicle",
                      "vehicles",
                    )}
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

function Freshness({ publishedAt }: { publishedAt: string | null }) {
  if (publishedAt === null) {
    return (
      <span className="text-amber-700 dark:text-amber-400">
        This yard&apos;s inventory has not refreshed in the last 3 days, so some
        listings may be gone.
      </span>
    );
  }
  return (
    <span className="text-muted-foreground">
      Inventory updated{" "}
      <time dateTime={publishedAt}>{InventoryFormat.date(publishedAt)}</time>.
    </span>
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
        <Button asChild variant="outline" size="sm">
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

const SHOWN_MAKES = 24;

function MakeSummary({
  makes,
  hrefs,
}: {
  makes: readonly MakeCount[];
  hrefs: ReadonlyMap<string, string>;
}) {
  const shown = makes.slice(0, SHOWN_MAKES);
  const rest = makes.length - shown.length;
  return (
    <section aria-labelledby="makes-title" className="mt-6">
      <h2 id="makes-title" className="text-sm font-medium">
        Makes in the yard
      </h2>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {shown.map(({ key, make, count: vehicles }) => {
          const href = hrefs.get(key);
          const label = (
            <>
              {make} <span className="text-muted-foreground">{vehicles}</span>
            </>
          );
          return (
            <li key={key} className="text-xs tabular-nums">
              {href ? (
                <Link
                  href={href}
                  prefetch={false}
                  title={`${make} vehicles at every yard`}
                  className="bg-muted hover:bg-accent block rounded-md px-2 py-1"
                >
                  {label}
                </Link>
              ) : (
                <span className="bg-muted block rounded-md px-2 py-1">
                  {label}
                </span>
              )}
            </li>
          );
        })}
        {rest > 0 && (
          <li className="text-muted-foreground px-2 py-1 text-xs">
            and {InventoryFormat.plural(rest, "more make", "more makes")}
          </li>
        )}
      </ul>
    </section>
  );
}

function VehicleRow({
  vehicle,
  source,
}: {
  vehicle: YardVehicle;
  source: string;
}) {
  const title = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .join(" ");
  const location = YardInventory.location(vehicle);
  const destination = isIngestionSource(source)
    ? VehicleDestination.resolve({ source, detailsUrl: vehicle.detailsUrl })
    : null;
  return (
    <li className="flex gap-3 p-3 sm:gap-4">
      <div className="bg-muted relative h-16 w-20 shrink-0 overflow-hidden rounded-md sm:h-18 sm:w-24">
        {vehicle.imageUrl && (
          <img
            src={wsrvLoader({ src: vehicle.imageUrl, width: 192 })}
            alt=""
            width={96}
            height={72}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-medium text-pretty">{title}</h3>
        <p className="text-muted-foreground mt-0.5 text-xs text-pretty">
          {[
            vehicle.color,
            location,
            `Added ${InventoryFormat.date(vehicle.addedAt)}`,
            vehicle.stockNumber && `Stock #${vehicle.stockNumber}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="mt-1 font-mono text-xs break-all select-all">
          {vehicle.vin}
        </p>
      </div>
      {destination?.kind === "inventory" && (
        <a
          href={destination.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-muted-foreground hover:text-foreground flex shrink-0 items-start gap-1 text-xs underline-offset-4 hover:underline"
        >
          <span className="hidden sm:inline">At the yard</span>
          <ArrowUpRight className="size-4" aria-hidden="true" />
          <span className="sr-only">
            {destination.label} for the {title} (opens in a new tab)
          </span>
        </a>
      )}
    </li>
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
