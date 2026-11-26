"use client";

import { YardService } from "~/lib/yard-service";
import { YardServiceLine } from "~/components/junkyards/YardServiceLine";
import { ArrowUpRight, ChevronRight, Copy, MapPin } from "lucide-react";
import Link from "next/link";
import { Analytics } from "~/lib/analytics";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { NoPhotoStrip, VehicleImage } from "~/components/search/VehicleImage";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ArrivalDate } from "~/lib/arrival-date";
import { AnalyticsEvents } from "~/lib/analytics-events";
import type { VehicleCardProps } from "~/lib/types";
import { VehicleCardDetails } from "~/lib/vehicle-card-details";
import { VehicleDestination } from "~/lib/vehicle-destination";
import { VehicleName } from "~/lib/vehicle-name";
import { useHiddenSources } from "~/components/HiddenSourcesContext";
import { useInventoryCheckLabel } from "~/components/InventoryCheckContext";

// About one line of small text on the narrowest card. Shorter manual search
// instructions ("Match the VIN, stock number and physical yard.") stay
// visible; folding them would hide less than the disclosure takes.
const ONE_LINE_INSTRUCTION = 50;

function VehicleCardComponent({
  vehicle,
  priority = false,
}: VehicleCardProps & { priority?: boolean }) {
  const destination = VehicleDestination.forSite(vehicle, useHiddenSources());
  const service = YardService.resolve(vehicle.source, vehicle.locationCode);
  const lastChecked = useInventoryCheckLabel(
    vehicle.source,
    vehicle.locationCode,
  );
  const [copyError, setCopyError] = useState<string | null>(null);
  const vin = vehicle.vin.trim();
  const primaryImage = vehicle.imageUrl;
  const stockNumber = VehicleCardDetails.text(vehicle.stockNumber);
  const position = VehicleCardDetails.position(vehicle);
  const miles = VehicleCardDetails.miles(vehicle.distance);
  const engine = VehicleCardDetails.text(vehicle.engine);
  const transmission = VehicleCardDetails.text(vehicle.transmission);
  // Yards often send all-caps models ("SPECTRA"); codes keep their caps.
  const model = VehicleName.display(vehicle.model);
  const title = `${vehicle.year} ${vehicle.make} ${model}`;
  const geoLabel =
    vehicle.locationCity && vehicle.locationCity !== "Unknown"
      ? `${vehicle.locationCity}, ${vehicle.stateAbbr}`
      : vehicle.stateAbbr || "Unknown";

  const handleDetailsClick = useCallback(() => {
    Analytics.capture(AnalyticsEvents.VEHICLE_DETAILS_CLICKED, {
      vehicle_id: vehicle.id,
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      source: vehicle.source,
      location_code: vehicle.locationCode,
      has_image: primaryImage !== null,
    });
  }, [primaryImage, vehicle]);

  const copyVin = async () => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(vin);
      toast.success("VIN copied");
    } catch {
      const message =
        "Could not copy VIN. Select and copy the VIN shown above.";
      setCopyError(message);
      toast.error(message);
    }
  };

  const missingLabel = vehicle.missingSinceAt
    ? `Missing since ${ArrivalDate.format(ArrivalDate.from(vehicle.missingSinceAt, null))}`
    : "Marked missing";

  return (
    <article
      aria-label={title}
      className="border-rule bg-paper text-ink flex h-full min-w-0 flex-col overflow-hidden border"
    >
      <VehicleImage
        priority={priority}
        src={primaryImage}
        alt={title}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        frame={(photo) => (
          <div className="border-rule border-b">
            <div className="bg-paper-2 relative aspect-[2/1] overflow-hidden">
              {photo}
              {stockNumber && (
                <Badge className="border-rule-strong bg-paper text-ink absolute top-2 right-2 rounded-none border tabular-nums">
                  Stock #{stockNumber}
                </Badge>
              )}
            </div>
          </div>
        )}
        missing={<NoPhotoStrip stockNumber={stockNumber} />}
      />

      <div className="flex-1 space-y-3 p-3 sm:p-4">
        <div>
          <h3 className="text-xl leading-tight font-medium text-balance break-words">
            <span className="tabular-nums">{vehicle.year}</span> {vehicle.make}{" "}
            {model}
          </h3>
          {vehicle.trim && (
            <p className="text-muted-foreground text-sm">{vehicle.trim}</p>
          )}
          {vehicle.sourceModel && vehicle.sourceModel !== vehicle.model && (
            <p className="text-muted-foreground text-xs">
              Yard model: {vehicle.sourceModel}
            </p>
          )}
          {VehicleCardDetails.text(vehicle.color) && (
            <p className="text-ink-2 mt-1 text-xs">{vehicle.color}</p>
          )}
          {vehicle.isMissing && (
            <Badge variant="destructive" className="mt-2">
              {missingLabel}
            </Badge>
          )}
          {lastChecked && (
            <p className="border-warning text-warning mt-2 inline-block border px-1.5 py-0.5 text-xs font-medium">
              {lastChecked}
            </p>
          )}
        </div>

        {service.kind !== "unknown" && (
          <div>
            <YardServiceLine service={service} hint />
          </div>
        )}
        {position && (
          <p className="border-rule-strong bg-paper-2 border-l px-2 py-1 text-xs leading-snug font-medium break-words">
            {position}
          </p>
        )}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs leading-snug">
          <dt className="text-muted-foreground">Yard</dt>
          <dd className="text-right break-words">
            {vehicle.locationName || "N/A"}
          </dd>

          {engine && (
            <>
              <dt className="text-muted-foreground">Engine</dt>
              <dd className="text-right break-words">{engine}</dd>
            </>
          )}
          {transmission && (
            <>
              <dt className="text-muted-foreground">Transmission</dt>
              <dd className="text-right break-words">{transmission}</dd>
            </>
          )}

          <dt className="text-muted-foreground">VIN</dt>
          <dd className="text-right font-mono break-all select-text">
            {vehicle.vin || "N/A"}
          </dd>

          <dt className="text-muted-foreground">Available</dt>
          <dd className="text-right tabular-nums">
            {ArrivalDate.format(vehicle.arrivalDate)}
          </dd>
        </dl>

        <div className="text-ink-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <MapPin aria-hidden="true" className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{geoLabel}</span>
          {miles && (
            <span
              className="text-ink shrink-0 font-medium tabular-nums"
              aria-label={`${miles} from your location`}
            >
              {miles}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-2 p-3 pt-0 sm:p-4 sm:pt-0">
        {(destination.kind === "unavailable" ||
          (destination.kind === "manual-search" &&
            destination.explanation.length <= ONE_LINE_INSTRUCTION)) && (
          <p className="text-muted-foreground text-xs text-pretty">
            {destination.explanation}
          </p>
        )}
        {destination.kind === "manual-search" &&
          destination.explanation.length > ONE_LINE_INSTRUCTION && (
            // Steps repeat on every card from the provider, so they stay folded.
            <details className="group text-xs">
              <summary className="text-muted-foreground hover:text-ink focus-visible:outline-focus flex min-h-6 cursor-pointer list-none items-center gap-1 outline-none focus-visible:outline-2 focus-visible:outline-solid [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden="true"
                  className="size-3.5 shrink-0 transition-transform group-open:rotate-90"
                />
                How to find this vehicle
              </summary>
              <p className="text-muted-foreground mt-1 text-pretty">
                {destination.explanation}
              </p>
            </details>
          )}
        {destination.kind !== "inventory" && (
          <>
            {vin && (
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-none"
                onClick={copyVin}
              >
                <Copy aria-hidden="true" data-icon="inline-start" />
                Copy VIN
              </Button>
            )}
            {copyError && (
              <p role="alert" className="text-destructive text-xs text-pretty">
                {copyError}
              </p>
            )}
          </>
        )}
        {destination.kind !== "unavailable" && (
          <Button
            asChild
            className="h-11 w-full rounded-none"
            variant="outline"
          >
            <Link
              href={destination.href}
              aria-label={`${destination.label} for the ${title} (opens in a new tab)`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleDetailsClick}
            >
              {destination.label}
              <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        )}
      </div>
    </article>
  );
}

// Memoize the component to prevent unnecessary re-renders
export const VehicleCard = memo(VehicleCardComponent);
