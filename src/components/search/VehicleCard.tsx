"use client";

import { ArrowUpRight, Copy, MapPin } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { VehicleImage } from "~/components/search/VehicleImage";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "~/components/ui/card";
import { AnalyticsEvents } from "~/lib/analytics-events";
import type { VehicleCardProps } from "~/lib/types";
import { VehicleDestination } from "~/lib/vehicle-destination";

function VehicleCardComponent({ vehicle }: VehicleCardProps) {
  const destination = VehicleDestination.resolve(vehicle);
  const [copyError, setCopyError] = useState<string | null>(null);
  const vin = vehicle.vin.trim();
  const primaryImage = vehicle.imageUrl;
  const geoLabel =
    vehicle.locationCity && vehicle.locationCity !== "Unknown"
      ? `${vehicle.locationCity}, ${vehicle.stateAbbr}`
      : vehicle.stateAbbr || "Unknown";

  const handleDetailsClick = useCallback(() => {
    posthog.capture(AnalyticsEvents.VEHICLE_DETAILS_CLICKED, {
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

  // Format date for display
  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return "Date unknown";
    }
  };

  const missingLabel = vehicle.missingSinceAt
    ? `Missing since ${formatDate(vehicle.missingSinceAt)}`
    : "Marked missing";

  return (
    <Card className="hover:border-foreground/20 h-full gap-0 overflow-hidden py-0 hover:shadow-md">
      <CardHeader className="p-0">
        {/* Vehicle Image */}
        <div className="bg-muted relative aspect-video overflow-hidden">
          {primaryImage ? (
            <VehicleImage
              src={primaryImage}
              alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="bg-muted flex h-full items-center justify-center">
              <div className="text-muted-foreground text-center">
                <p className="text-sm">No Image Available</p>
              </div>
            </div>
          )}
          {/* Stock Number Badge */}
          <Badge className="absolute top-3 right-3 tabular-nums">
            Stock #{vehicle.stockNumber}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-4">
        <div className="mb-4">
          <h3 className="truncate text-lg font-semibold text-balance">
            <span className="tabular-nums">{vehicle.year}</span> {vehicle.make}{" "}
            {vehicle.model}
          </h3>
          <p className="text-muted-foreground mt-1 text-sm">{vehicle.color}</p>
          {vehicle.isMissing && (
            <Badge variant="destructive" className="mt-2">
              {missingLabel}
            </Badge>
          )}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Yard</dt>
          <dd className="truncate text-right">
            {vehicle.locationName || "N/A"}
          </dd>

          <dt className="text-muted-foreground">VIN</dt>
          <dd className="text-right font-mono break-all select-text">
            {vehicle.vin || "N/A"}
          </dd>

          <dt className="text-muted-foreground">Available</dt>
          <dd className="text-right tabular-nums">
            {formatDate(vehicle.availableDate)}
          </dd>
        </dl>

        <div className="text-muted-foreground mt-4 flex items-center gap-1.5 text-sm">
          <MapPin aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{geoLabel}</span>
        </div>
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-2 p-4 pt-0">
        {destination.kind !== "inventory" && (
          <>
            <p className="text-muted-foreground text-xs text-pretty">
              {destination.explanation}
            </p>
            {vin && (
              <Button type="button" variant="outline" onClick={copyVin}>
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
          <Button asChild className="w-full" variant="default">
            <Link
              href={destination.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleDetailsClick}
            >
              {destination.label}
              <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

// Memoize the component to prevent unnecessary re-renders
export const VehicleCard = memo(VehicleCardComponent);
