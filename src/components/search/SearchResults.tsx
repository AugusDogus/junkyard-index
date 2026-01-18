"use client";

/**
 * SearchResults - A high-performance virtualized grid component for rendering large lists of VehicleCards.
 *
 * This component uses TanStack Virtual to efficiently render only the visible items in the viewport,
 * dramatically improving performance when dealing with 1000+ vehicles.
 *
 * Key features:
 * - Virtualized rendering: Only renders visible rows + overscan
 * - Responsive grid: Automatically adjusts columns based on screen size and sidebar state
 * - Smooth scrolling: Optimized for large datasets
 * - Memory efficient: Reuses DOM nodes and minimizes re-renders
 */

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo } from "react";
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
  return (
    <div className="text-muted-foreground text-center text-sm">
      <p>
        Showing {searchResult.vehicles.length} of{" "}
        {searchResult.totalCount.toLocaleString()} vehicles
        {searchResult.locationsCovered > 0 && (
          <span className="ml-1">
            from {searchResult.locationsCovered} locations
          </span>
        )}
      </p>
      {searchResult.locationsWithErrors.length > 0 && (
        <p className="text-destructive mt-1 text-xs">
          {searchResult.locationsWithErrors.length} locations had errors
        </p>
      )}
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

  // Calculate grid columns based on sidebar state and screen size
  const getGridColumns = () => {
    if (isMobile) return 1;
    if (sidebarOpen) return 2;
    return 3; // xl:grid-cols-3 for desktop without sidebar
  };

  const columns = getGridColumns();

  // Group vehicles into rows for simpler virtualization
  const rows = useMemo(() => {
    if (!searchResult.vehicles) return [];
    const result: Vehicle[][] = [];
    for (let i = 0; i < searchResult.vehicles.length; i += columns) {
      result.push(searchResult.vehicles.slice(i, i + columns));
    }
    return result;
  }, [searchResult.vehicles, columns]);

  // Calculate card height based on column count
  const getCardHeight = () => {
    if (isMobile) return 477.88; // 1 column
    if (sidebarOpen) return 497.38; // 2 columns
    return 477.88; // 3 columns
  };

  const cardHeight = getCardHeight();
  const gapHeight = 24; // gap-6 = 24px
  const rowHeight = cardHeight + gapHeight;

  // Single virtualizer for rows - much simpler and more reliable
  const rowVirtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollPaddingEnd: 100,
  });

  // Recalculate when columns change
  useEffect(() => {
    rowVirtualizer.measure();
  }, [columns, rowVirtualizer]);

  const amountOfSkeletons = isMobile ? 1 : 6;

  if (isLoading) {
    return (
      <div
        className="grid w-full gap-6"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }}
      >
        {/* Loading Skeletons */}
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
      style={{
        height: `${rowVirtualizer.getTotalSize()}px`,
        width: "100%",
        position: "relative",
      }}
    >
      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (!row) return null;

        return (
          <div
            key={`row-${virtualRow.index}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            <div
              className="grid w-full gap-6"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              }}
            >
              {row.map((vehicle: Vehicle) => (
                <VehicleCard
                  key={`${vehicle.location.locationCode}-${vehicle.id}`}
                  vehicle={vehicle}
                />
              ))}
              {/* Fill remaining grid slots if row has fewer items than columns */}
              {Array.from({ length: Math.max(0, columns - row.length) }).map(
                (_, index) => (
                  <div key={`empty-${index}`} className="h-full" />
                ),
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
