"use client";

import { Eye, MapPin } from "lucide-react";
import Link from "next/link";
import posthog from "posthog-js";
import { memo, useCallback } from "react";
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

function VehicleCardComponent({ vehicle }: VehicleCardProps) {
  const primaryImage = vehicle.imageUrl;

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
    <Card className="group gap-0 overflow-hidden py-0 transition-shadow hover:shadow-lg">
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
          <Badge className="absolute top-3 right-3">
            Stock #{vehicle.stockNumber}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        {/* Year Make Model */}
        <div className="mb-3">
          <h3 className="text-foreground text-lg font-semibold">
            {vehicle.year} {vehicle.make} {vehicle.model}
          </h3>
          <p className="text-muted-foreground text-sm">
            Color: {vehicle.color}
          </p>
          {vehicle.isMissing && (
            <Badge variant="destructive" className="mt-2">
              {missingLabel}
            </Badge>
          )}
        </div>

        {/* Vehicle Details */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Location:</span>
            <span className="max-w-[65%] text-right text-xs">
              {vehicle.locationName || "N/A"}
            </span>
          </div>

          <div className="flex justify-between">
            <span className="text-muted-foreground">VIN:</span>
            <span className="font-mono text-xs">{vehicle.vin || "N/A"}</span>
          </div>

          {(vehicle.section || vehicle.row || vehicle.space) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Yard Spot:</span>
              <span className="text-xs">
                {[vehicle.section, vehicle.row, vehicle.space]
                  .filter(Boolean)
                  .join("-") || "N/A"}
              </span>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-muted-foreground">Available:</span>
            <span className="text-xs">{formatDate(vehicle.availableDate)}</span>
          </div>
        </div>

        {/* Location */}
        <div className="text-muted-foreground mt-3 flex items-center text-sm">
          <MapPin className="mr-1.5 h-4 w-4" />
          <span>
            {vehicle.locationCity
              ? `${vehicle.locationCity}, ${vehicle.stateAbbr}`
              : vehicle.stateAbbr}
          </span>
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0">
        <Button asChild className="w-full" variant="default">
          <Link
            href={vehicle.detailsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleDetailsClick}
          >
            <Eye className="mr-1.5 h-4 w-4" />
            View Details
          </Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

// Memoize the component to prevent unnecessary re-renders
export const VehicleCard = memo(VehicleCardComponent);
