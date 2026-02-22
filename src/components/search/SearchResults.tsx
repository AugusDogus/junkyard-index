"use client";

/**
 * SearchResults — renders a responsive grid of VehicleCards.
 *
 * With Algolia pagination (1000 items per page), the result set is small enough
 * to render without virtualization. This avoids the scroll position and
 * measurement bugs that occur when the virtualizer resets on data changes.
 */

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { useIsMobile } from "~/hooks/use-media-query";
import type { SearchResult, Vehicle } from "~/lib/types";
import { VehicleCard } from "./VehicleCard";

interface SearchSummaryProps {
  searchResult: SearchResult;
}

export function SearchSummary({ searchResult }: SearchSummaryProps) {
  const loaded = searchResult.vehicles.length;
  const total = searchResult.totalCount;
  const allLoaded = loaded >= total;

  return (
    <div className="text-muted-foreground text-center text-sm">
      <p>
        {allLoaded
          ? `${total.toLocaleString()} vehicles`
          : `Showing ${loaded.toLocaleString()} of ${total.toLocaleString()} vehicles`}
      </p>
    </div>
  );
}

interface SearchResultsProps {
  searchResult: SearchResult;
  isLoading: boolean;
  sidebarOpen?: boolean;
}

export function SearchResults({
  searchResult,
  isLoading,
  sidebarOpen = false,
}: SearchResultsProps) {
  const isMobile = useIsMobile();

  const getGridColumns = () => {
    if (isMobile) return 1;
    if (sidebarOpen) return 2;
    return 3;
  };

  const columns = getGridColumns();
  const amountOfSkeletons = isMobile ? 1 : 6;

  if (isLoading) {
    return (
      <div
        className="grid w-full gap-6"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}
      >
        {Array.from({ length: amountOfSkeletons }).map((_, index) => (
          <Card
            key={index}
            className="min-h-[482px] gap-0 overflow-hidden py-0"
          >
            <CardHeader className="p-0">
              <Skeleton className="aspect-video rounded-t-md rounded-b-none" />
            </CardHeader>
            <CardContent className="h-full space-y-3 p-4">
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-4 w-1/4" />
              <div className="space-y-2">
                <div className="flex flex-row justify-between gap-2">
                  <Skeleton className="h-4 w-1/6" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
                <div className="flex flex-row justify-between gap-2">
                  <Skeleton className="h-4 w-2/6" />
                  <Skeleton className="h-4 w-1/4" />
                </div>
                <div className="flex flex-row justify-between gap-2">
                  <Skeleton className="h-4 w-2/6" />
                  <Skeleton className="h-4 w-1/4" />
                </div>
              </div>
              <div className="flex items-center space-x-2 pt-2">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
            </CardContent>
            <CardFooter className="p-4 pt-0">
              <Skeleton className="h-9 w-full" />
            </CardFooter>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid w-full gap-6"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
    >
      {searchResult.vehicles.map((vehicle: Vehicle) => (
        <VehicleCard
          key={`${vehicle.location.locationCode}-${vehicle.id}`}
          vehicle={vehicle}
        />
      ))}
    </div>
  );
}
