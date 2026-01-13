"use client";

import { Eye, ImageIcon, MapPin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { memo } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "~/components/ui/card";
import type { VehicleCardProps } from "~/lib/types";
import wsrvLoader from "~/lib/wsrvLoader";

function VehicleCardComponent({
  vehicle,
  onImageClick: _onImageClick,
}: VehicleCardProps) {
  const primaryImage = vehicle.images[0];
  const hasMultipleImages = vehicle.images.length > 1;

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

  return (
    <Card className="group gap-0 overflow-hidden py-0 transition-shadow hover:shadow-lg">
      <CardHeader className="p-0">
        {/* Vehicle Image */}
        <div className="bg-muted relative aspect-video overflow-hidden">
          {primaryImage ? (
            <Image
              loader={wsrvLoader}
              src={primaryImage.url}
              alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            />
          ) : (
            <div className="bg-muted flex h-full items-center justify-center">
              <div className="text-muted-foreground text-center">
                <p className="text-sm">No Image Available</p>
              </div>
            </div>
          )}

          {/* Image Count Badge */}
          {hasMultipleImages && (
            <Badge
              variant="secondary"
              className="absolute top-3 left-3 bg-black/50 text-white hover:bg-black/70"
            >
              <ImageIcon />
              {vehicle.images.length - 1} more
            </Badge>
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
        </div>

        {/* Vehicle Details */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">VIN:</span>
            <span className="font-mono text-xs">{vehicle.vin || "N/A"}</span>
          </div>

          {(vehicle.yardLocation.section ||
            vehicle.yardLocation.row ||
            vehicle.yardLocation.space) && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Location:</span>
              <span className="text-xs">
                {[
                  vehicle.yardLocation.section,
                  vehicle.yardLocation.row,
                  vehicle.yardLocation.space,
                ]
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
            {vehicle.location.displayName}, {vehicle.location.stateAbbr}
          </span>
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0">
        <Button asChild className="w-full" variant="default">
          <Link
            href={vehicle.detailsUrl}
            target="_blank"
            rel="noopener noreferrer"
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
