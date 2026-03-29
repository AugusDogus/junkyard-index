"use client";

/**
 * SearchResults - A high-performance virtualized grid component for rendering large lists of VehicleCards.
 *
 * Uses TanStack Virtual's useWindowVirtualizer (window as scroll container)
 * with dynamic row measurement to prevent card overlap at any viewport size.
 * Triggers showMore() when the last virtual item is near the end of loaded data,
 * following the TanStack Virtual infinite scroll pattern.
 */

import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { useIsMobile, useIsMediumScreen } from "~/hooks/use-media-query";
import type { SearchResult, SearchVehicle } from "~/lib/types";
import { VehicleCard } from "./VehicleCard";

interface SearchSummaryProps {
  searchResult: SearchResult;
}

export function SearchSummary({ searchResult }: SearchSummaryProps) {
  const loaded = searchResult.vehicles.length;
  const total = searchResult.totalCount;
  const allLoaded = loaded >= total;

  return (
    <div className="text-muted-foreground pt-4 text-center text-sm">
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
  isFetchingNextPage?: boolean;
}

export function SearchResults({
  searchResult,
  isLoading,
  sidebarOpen = false,
  showMore,
  isLastPage = true,
  isFetchingNextPage = false,
}: SearchResultsProps) {
  const isMobile = useIsMobile();
  const isMediumScreen = useIsMediumScreen();

  const getGridColumns = useCallback(() => {
    if (isMobile) return 1;
    if (isMediumScreen) return sidebarOpen ? 1 : 2;
    if (sidebarOpen) return 2;
    return 3;
  }, [isMobile, isMediumScreen, sidebarOpen]);

  const columns = getGridColumns();

  const rows = useMemo(() => {
    if (!searchResult.vehicles) return [];
    const result: SearchVehicle[][] = [];
    for (let i = 0; i < searchResult.vehicles.length; i += columns) {
      result.push(searchResult.vehicles.slice(i, i + columns));
    }
    return result;
  }, [searchResult.vehicles, columns]);

  const gapHeight = 24;
  const estimatedCardHeight = 480;
  const estimatedRowHeight = estimatedCardHeight + gapHeight;

  const rowCount = !isLastPage ? rows.length + 1 : rows.length;

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => estimatedRowHeight,
    overscan: 5,
    scrollPaddingEnd: 100,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastVirtualItemIndex =
    virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (
      lastVirtualItemIndex >= rows.length - 1 &&
      !isLastPage &&
      !isFetchingNextPage &&
      showMore
    ) {
      showMore();
    }
  }, [
    lastVirtualItemIndex,
    rows.length,
    isLastPage,
    isFetchingNextPage,
    showMore,
  ]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [columns, rowVirtualizer]);

  const amountOfSkeletons = isMobile ? 1 : isMediumScreen ? 2 : 6;

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
            className="gap-0 overflow-hidden py-0"
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
        const isLoaderRow = virtualRow.index >= rows.length;
        const row = rows[virtualRow.index];

        return (
          <div
            key={`row-${virtualRow.index}`}
            data-index={virtualRow.index}
            ref={rowVirtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {isLoaderRow ? (
              <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
                Loading more vehicles...
              </div>
            ) : row ? (
              <div
                className="grid w-full gap-6 pb-6"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {row.map((vehicle: SearchVehicle) => (
                  <VehicleCard
                    key={`${vehicle.locationCode}-${vehicle.id}`}
                    vehicle={vehicle}
                  />
                ))}
                {Array.from({
                  length: Math.max(0, columns - row.length),
                }).map((_, index) => (
                  <div key={`empty-${index}`} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
