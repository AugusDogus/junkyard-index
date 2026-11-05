import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AlertsCallout } from "~/components/junkyards/AlertsCallout";
import { Breadcrumbs } from "~/components/junkyards/Breadcrumbs";
import { JsonLd } from "~/components/JsonLd";
import { env } from "~/env";
import { isIngestionSource } from "~/lib/ingestion-source";
import { InventoryFormat } from "~/lib/inventory-format";
import { MakeInventory, type ModelEntry } from "~/lib/make-inventory";
import { SITE_OPEN_GRAPH } from "~/lib/site-metadata";
import { StructuredData, type Crumb } from "~/lib/structured-data";
import { VehicleDestination } from "~/lib/vehicle-destination";
import { VehicleName } from "~/lib/vehicle-name";
import wsrvLoader from "~/lib/wsrvLoader";
import { YardInventory } from "~/lib/yard-inventory";
import { YardName } from "~/lib/yard-name";
import { YardPath } from "~/lib/yard-path";
import type { MakeEntry, ModelArrival } from "~/server/vehicle-models";
import type { RoutedYard } from "~/server/yard-inventory";

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
  const description = `${InventoryFormat.plural(model.count, `${name} vehicle`, `${name} vehicles`)} at ${InventoryFormat.plural(yardCount, "salvage yard", "salvage yards")}, model years ${InventoryFormat.years(model)}, with the newest arrivals' row and VIN and every yard that has one.${
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

export function ModelInventoryView({
  make,
  model,
  yards,
  arrivals,
  publishedAt,
}: {
  make: MakeEntry;
  model: ModelEntry;
  /** Yards holding the model, in the model's order (most first). */
  yards: readonly { yard: RoutedYard; count: number; years: string }[];
  arrivals: readonly ModelArrival[];
  publishedAt: string | null;
}) {
  const name = VehicleName.title(make.name, model.name);
  const crumbs = modelCrumbs(make, model);
  const byKey = new Map(
    yards.map(({ yard }) => [`${yard.source}:${yard.code}`, yard]),
  );
  const routed = yards.map(({ yard }) => yard);

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
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {name} at junkyards
      </h1>
      <p className="mt-3 text-base text-pretty">
        <span className="font-medium tabular-nums">
          {InventoryFormat.plural(
            model.count,
            `${name} vehicle`,
            `${name} vehicles`,
          )}
        </span>
        , model years {InventoryFormat.years(model)}, at{" "}
        {InventoryFormat.plural(yards.length, "yard", "yards")} we track in{" "}
        {regionLabel(routed)}.{" "}
        {publishedAt ? (
          <span className="text-muted-foreground">
            Inventory updated{" "}
            <time dateTime={publishedAt}>
              {InventoryFormat.date(publishedAt)}
            </time>
            .
          </span>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">
            These yards&apos; inventory has not refreshed in the last 3 days, so
            some listings may be gone.
          </span>
        )}
      </p>

      {arrivals.length > 0 && (
        <section aria-labelledby="arrivals-title" className="mt-8">
          <h2 id="arrivals-title" className="text-xl font-semibold">
            Newest {name} arrivals
          </h2>
          <ul className="mt-4 divide-y rounded-lg border">
            {arrivals.map((vehicle) => (
              <ArrivalRow
                key={vehicle.vin}
                vehicle={vehicle}
                yard={byKey.get(`${vehicle.source}:${vehicle.code}`) ?? null}
              />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="yards-title" className="mt-10">
        <h2 id="yards-title" className="text-xl font-semibold">
          Yards with {name} vehicles
        </h2>
        {YardPath.byRegion(routed).map(({ region, yards: regionYards }) => (
          <div key={region.slug} className="mt-6">
            <h3 className="text-muted-foreground mb-2 text-sm font-medium">
              {region.name}
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {regionYards.map((yard) => {
                const entry = yards.find(
                  (candidate) => candidate.yard.path.href === yard.path.href,
                );
                return (
                  <li key={yard.path.href}>
                    <Link
                      href={yard.path.href}
                      prefetch={false}
                      className="hover:bg-muted flex h-full flex-col rounded-lg border p-3"
                    >
                      <span className="text-sm font-medium text-pretty">
                        {YardName.headline(yard.name, yard.operator)}
                      </span>
                      <span className="text-muted-foreground mt-1 text-xs tabular-nums">
                        {yard.city}, {yard.state} ·{" "}
                        {InventoryFormat.count(entry?.count ?? 0)} {model.name}{" "}
                        · {entry?.years}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <AlertsCallout
        subject={`a new ${name} arrival shows up at any yard we track`}
        sourcePage="model"
      />
      <p className="text-muted-foreground mt-6 text-sm">
        More{" "}
        <Link
          href={make.href}
          className="hover:text-foreground underline underline-offset-4"
        >
          {make.name} models at junkyards
        </Link>
        .
      </p>
    </>
  );
}

function ArrivalRow({
  vehicle,
  yard,
}: {
  vehicle: ModelArrival;
  yard: RoutedYard | null;
}) {
  const title = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim]
    .filter(Boolean)
    .join(" ");
  const location = YardInventory.location(vehicle);
  const destination = isIngestionSource(vehicle.source)
    ? VehicleDestination.resolve({
        source: vehicle.source,
        detailsUrl: vehicle.detailsUrl,
      })
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
        {yard && (
          <p className="mt-0.5 text-xs">
            <Link
              href={yard.path.href}
              prefetch={false}
              className="underline-offset-4 hover:underline"
            >
              {YardName.headline(yard.name, yard.operator)}
            </Link>
            <span className="text-muted-foreground">
              {" "}
              · {yard.city}, {yard.state}
            </span>
          </p>
        )}
        <p className="text-muted-foreground mt-0.5 text-xs text-pretty">
          {[
            vehicle.color,
            location,
            `Added ${InventoryFormat.date(vehicle.addedAt)}`,
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
