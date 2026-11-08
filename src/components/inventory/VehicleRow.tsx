import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { isIngestionSource } from "~/lib/ingestion-source";
import { VehicleDestination } from "~/lib/vehicle-destination";
import { VehicleName } from "~/lib/vehicle-name";
import wsrvLoader from "~/lib/wsrvLoader";
import { YardInventory, type YardVehicle } from "~/lib/yard-inventory";

/**
 * One vehicle in a yard's inventory, ordered by what someone heading to the
 * yard needs: what it is, where it sits in the yard, when it arrived, then
 * the identifiers to confirm it.
 */
export function VehicleRow({
  vehicle,
  source,
  publishedAt,
  yard,
}: {
  vehicle: YardVehicle;
  source: string;
  /** The yard's latest inventory update, for the "New" label. */
  publishedAt: string | null;
  /** Which yard it's at, for lists that span yards. */
  yard?: { name: string; href: string; place: string };
}) {
  const title = [
    vehicle.year,
    VehicleName.display(vehicle.make),
    VehicleName.display(vehicle.model),
    vehicle.trim && VehicleName.display(vehicle.trim),
  ]
    .filter(Boolean)
    .join(" ");
  const location = YardInventory.location(vehicle);
  const destination = isIngestionSource(source)
    ? VehicleDestination.resolve({ source, detailsUrl: vehicle.detailsUrl })
    : null;
  const details = [
    vehicle.color,
    vehicle.engine,
    YardInventory.addedLabel(vehicle),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex gap-3 py-4 sm:gap-4">
      <div className="bg-muted relative h-18 w-24 shrink-0 overflow-hidden rounded-md sm:h-24 sm:w-32">
        {vehicle.imageUrl ? (
          <img
            src={wsrvLoader({ src: vehicle.imageUrl, width: 256 })}
            alt=""
            width={128}
            height={96}
            loading="lazy"
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <span className="text-muted-foreground absolute inset-0 grid place-items-center px-1 text-center text-[11px]">
            No photo
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold text-pretty">
            {title}
          </h3>
          {YardInventory.isNew(vehicle, publishedAt) && (
            <span className="bg-foreground text-background shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium">
              New
            </span>
          )}
        </div>
        {yard && (
          <p className="mt-0.5 text-xs">
            <Link
              href={yard.href}
              prefetch={false}
              className="font-medium underline-offset-4 hover:underline"
            >
              {yard.name}
            </Link>
            <span className="text-muted-foreground"> · {yard.place}</span>
          </p>
        )}
        {location ? (
          <p className="bg-muted mt-1.5 inline-block rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums">
            {location}
          </p>
        ) : (
          <p className="text-muted-foreground mt-1.5 text-xs">
            Row not listed by the yard
          </p>
        )}
        <p className="text-muted-foreground mt-1.5 text-xs text-pretty tabular-nums">
          {details}
        </p>
        <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <span>
            VIN{" "}
            <span className="text-foreground/80 font-mono select-all">
              {vehicle.vin}
            </span>
          </span>
          {vehicle.stockNumber && <span>Stock #{vehicle.stockNumber}</span>}
          {destination?.kind === "inventory" && (
            <a
              href={destination.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-foreground inline-flex items-center gap-0.5 font-medium underline-offset-4 hover:underline"
            >
              Yard listing
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
              <span className="sr-only">
                {" "}
                for the {title} (opens in a new tab)
              </span>
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
