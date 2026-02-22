"use client";

/**
 * SearchResults — Virtualized grid of VehicleCards with infinite scroll.
 *
 * Uses TanStack Virtual's useVirtualizer with a fixed-height scroll container.
 * Follows the official infinite scroll pattern: the virtualizer monitors the
 * last visible item and triggers showMore() when approaching the end.
 *
 * @see https://tanstack.com/virtual/latest/docs/framework/react/examples/infinite-scroll
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useMemo, useRef } from "react";
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
  showMore?: () => void;
  isLastPage?: boolean;
}

export function SearchResults({
  searchResult,
  isLoading,
  sidebarOpen = false,
  showMore,
  isLastPage = true,
}: SearchResultsProps) {
  const isMobile = useIsMobile();

  const getGridColumns = () => {
    if (isMobile) return 1;
    if (sidebarOpen) return 2;
    return 3;
  };

  const columns = getGridColumns();

  // Group vehicles into rows for grid virtualization
  const rows = useMemo(() => {
    if (!searchResult.vehicles) return [];
    const result: Vehicle[][] = [];
    for (let i = 0; i < searchResult.vehicles.length; i += columns) {
      result.push(searchResult.vehicles.slice(i, i + columns));
    }
    return result;
  }, [searchResult.vehicles, columns]);

  // Include an extra "loader" row when there are more pages to load
  const rowCount = !isLastPage ? rows.length + 1 : rows.length;

  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (isMobile ? 502 : sidebarOpen ? 522 : 502),
    overscan: 5,
  });

  // Trigger showMore when the last virtual item is near the end of loaded data.
  // This is the TanStack Virtual recommended infinite scroll pattern.
  useEffect(() => {
    const virtualItems = rowVirtualizer.getVirtualItems();
    const lastItem = virtualItems[virtualItems.length - 1];

    if (!lastItem) return;

    if (lastItem.index >= rows.length - 1 && !isLastPage && showMore) {
      showMore();
    }
  }, [rowVirtualizer.getVirtualItems(), rows.length, isLastPage, showMore]);

  // Recalculate sizes when columns change
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
      ref={parentRef}
      style={{
        height: "calc(100vh - 200px)",
        overflow: "auto",
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const isLoaderRow = virtualRow.index >= rows.length;
          const row = rows[virtualRow.index];

          return (
            <div
              key={virtualRow.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {isLoaderRow ? (
                <div className="text-muted-foreground py-8 text-center text-sm">
                  {!isLastPage ? "Loading more vehicles..." : ""}
                </div>
              ) : row ? (
                <div
                  className="grid w-full gap-6 pb-6"
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
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
