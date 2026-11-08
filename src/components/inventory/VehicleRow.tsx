import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { cn } from "~/lib/utils";
import { isIngestionSource } from "~/lib/ingestion-source";
import { VehicleDestination } from "~/lib/vehicle-destination";
import { VehicleName } from "~/lib/vehicle-name";
import wsrvLoader from "~/lib/wsrvLoader";
import { YardInventory, type YardVehicle } from "~/lib/yard-inventory";

const linkClassName =
  "board-step text-ink hover:text-signal active:text-ink focus-visible:outline-focus underline decoration-1 underline-offset-[0.3em] outline-none hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid";

/**
 * One vehicle in a yard's inventory, ordered by what someone heading to the
 * yard needs: what it is and where it sits in the yard, when it arrived,
 * then the identifiers to confirm it. In a full-width yard list (`columns`)
 * those three sit side by side from the lg breakpoint; in a narrower list
 * (`stacked`) they stack. A viewport breakpoint, not a container query: a
 * yard page renders 100 rows, and 100 size containers cost every page view
 * extra style and layout work.
 */
export function VehicleRow({
  vehicle,
  source,
  publishedAt,
  yard,
  layout,
}: {
  vehicle: YardVehicle;
  source: string;
  /** The yard's latest inventory update, for the "New" label. */
  publishedAt: string | null;
  /** Which yard it's at, for lists that span yards. */
  yard?: { name: string; href: string; place: string };
  /** `columns` for a full-width list, `stacked` for one beside other content. */
  layout: "columns" | "stacked";
}) {
  const columns = layout === "columns";
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
  ].filter((detail): detail is string => Boolean(detail));

  return (
    <li className="flex gap-4 py-5 sm:gap-6">
      <div className="border-ink bg-paper-2 relative aspect-[4/3] w-24 shrink-0 self-start overflow-hidden border-2 sm:w-[8.25rem]">
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
          <span className="text-ink-3 absolute inset-0 grid place-items-center px-1 text-center text-xs">
            No photo
          </span>
        )}
      </div>
      <div
        className={cn(
          "grid min-w-0 flex-1 content-start gap-y-2",
          columns &&
            "lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-x-6",
        )}
      >
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <h3 className="min-w-0 flex-1 text-[1.0625rem] leading-snug font-extrabold tracking-[-0.01em]">
              {title}
            </h3>
            {YardInventory.isNew(vehicle, publishedAt) && (
              <span className="border-signal text-signal shrink-0 border-2 px-1.5 text-xs leading-5 font-extrabold">
                New
              </span>
            )}
          </div>
          {yard && (
            <p className="text-ink-3 mt-1 text-sm">
              <Link href={yard.href} prefetch={false} className={linkClassName}>
                {yard.name}
              </Link>
              <span className="block">{yard.place}</span>
            </p>
          )}
          <div className="mt-2">
            {location ? (
              <p className="bg-ink text-paper inline-block px-2 py-0.5 text-sm font-extrabold tabular-nums">
                {location}
              </p>
            ) : (
              <p className="text-ink-3 text-sm">Row not listed by the yard</p>
            )}
          </div>
        </div>
        <ul
          className={cn(
            "text-ink-2 flex flex-wrap gap-x-5 gap-y-0.5 text-sm tabular-nums",
            columns && "lg:flex-col",
          )}
        >
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
        <div
          className={cn(
            "text-ink-3 flex flex-wrap items-center gap-x-5 gap-y-0.5 text-[0.8125rem]",
            columns && "lg:flex-col lg:items-start",
          )}
        >
          <span>
            VIN <span className="text-ink-2 select-all">{vehicle.vin}</span>
          </span>
          {vehicle.stockNumber && <span>Stock #{vehicle.stockNumber}</span>}
          {destination?.kind === "inventory" && (
            <a
              href={destination.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className={`${linkClassName} inline-flex items-center gap-1 font-medium`}
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
