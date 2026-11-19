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
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { useIsMobile, useIsMediumScreen } from "~/hooks/use-media-query";
import type { SearchResult, SearchVehicle } from "~/lib/types";
import { SearchScroll } from "~/lib/search-scroll";
import { VehicleCard } from "./VehicleCard";

interface SearchSummaryProps {
  searchResult: SearchResult;
  visibleCount?: number;
}

export function SearchSummary({
  searchResult,
  visibleCount,
}: SearchSummaryProps) {
  const loaded = visibleCount ?? searchResult.vehicles.length;
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
  sessionKey?: string;
  searchResult: SearchResult;
  isLoading: boolean;
  showMore?: () => void;
  isLastPage?: boolean;
  isFetchingNextPage?: boolean;
  lockedPreview?: {
    clearRows: number;
    overlay: ReactNode;
  };
}

export function SearchResults({
  searchResult,
  sessionKey,
  isLoading,
  showMore,
  isLastPage = true,
  isFetchingNextPage = false,
  lockedPreview,
}: SearchResultsProps) {
  const isMobile = useIsMobile();
  const isMediumScreen = useIsMediumScreen();

  const getGridColumns = useCallback(() => {
    if (isMobile ?? lockedPreview?.clearRows === 3) return 1;
    if (isMediumScreen) return 2;
    return 3;
  }, [isMobile, isMediumScreen, lockedPreview?.clearRows]);

  const columns = getGridColumns();

  // Keep the first cards in normal document flow, including SSR. The virtual
  // tail starts below them, so measuring the viewport never hides the LCP image.
  const firstVehicles = searchResult.vehicles.slice(0, 3);
  const isLockedPreview = Boolean(lockedPreview);
  const tailRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [rowWidth, setRowWidth] = useState(1000);
  useLayoutEffect(() => {
    const element = tailRef.current;
    if (!element) return;
    const measure = () => {
      setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
      setRowWidth(element.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    const main = element.closest("main");
    if (main) observer.observe(main);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [isLoading, isLockedPreview]);

  const rows = useMemo(() => {
    if (!searchResult.vehicles) return [];
    const result: SearchVehicle[][] = [];
    for (
      let i = lockedPreview ? 0 : 3;
      i < searchResult.vehicles.length;
      i += columns
    ) {
      result.push(searchResult.vehicles.slice(i, i + columns));
    }
    return result;
  }, [searchResult.vehicles, columns, lockedPreview]);

  const gapHeight = 16;
  const estimatedCardHeight =
    (((rowWidth - (columns - 1) * gapHeight) / columns) * 9) / 16 + 360;
  const estimatedRowHeight = estimatedCardHeight + gapHeight;

  const rowCount = !isLastPage ? rows.length + 1 : rows.length;

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    enabled: !isLockedPreview && !isLoading,
    estimateSize: () => estimatedRowHeight,
    overscan: 2,
    scrollMargin,
    scrollPaddingEnd: 100,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastVirtualItemIndex =
    virtualItems[virtualItems.length - 1]?.index ?? -1;

  useEffect(() => {
    if (
      !lockedPreview &&
      rows.length > 0 &&
      lastVirtualItemIndex >= rows.length - 1 &&
      !isLastPage &&
      !isFetchingNextPage &&
      showMore
    ) {
      showMore();
    }
  }, [
    lastVirtualItemIndex,
    lockedPreview,
    rows.length,
    isLastPage,
    isFetchingNextPage,
    showMore,
  ]);

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [columns, estimatedRowHeight, rowVirtualizer]);

  useLayoutEffect(() => {
    if (!sessionKey || isLoading || isLockedPreview) return;
    const snapshot = SearchScroll.read(sessionKey);
    let frame = 0;
    if (snapshot) {
      snapshot.rowSizes.forEach((size, index) =>
        rowVirtualizer.resizeItem(index, size),
      );
      // Restore the cached pages and row geometry first. The second frame
      // follows the virtualizer's measured render at the restored offset.
      frame = requestAnimationFrame(() => {
        window.scrollTo(0, snapshot.scrollY);
        frame = requestAnimationFrame(() =>
          window.scrollTo(0, snapshot.scrollY),
        );
      });
    }
    const save = () =>
      SearchScroll.write(sessionKey, {
        width: window.innerWidth,
        scrollY: window.scrollY,
        rowSizes: rowVirtualizer.measurementsCache.map((row) => row.size),
      });
    window.addEventListener("pagehide", save);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pagehide", save);
    };
  }, [
    sessionKey,
    isLoading,
    isLockedPreview,
    rowVirtualizer,
    estimatedRowHeight,
  ]);

  const amountOfSkeletons = 6;

  const renderGridRow = useCallback(
    (row: SearchVehicle[], keyPrefix: string, className?: string) => (
      <div
        key={keyPrefix}
        className={`grid w-full grid-cols-1 gap-4 pb-4 md:grid-cols-2 lg:grid-cols-3 ${className ?? ""}`}
      >
        {row.map((vehicle: SearchVehicle) => (
          <VehicleCard
            key={`${keyPrefix}-${vehicle.locationCode}-${vehicle.id}`}
            vehicle={vehicle}
            priority={keyPrefix === "preview-clear-0"}
          />
        ))}
        {Array.from({
          length: Math.max(0, columns - row.length),
        }).map((_, index) => (
          <div key={`${keyPrefix}-empty-${index}`} />
        ))}
      </div>
    ),
    [columns],
  );

  if (isLoading) {
    return (
      <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: amountOfSkeletons }).map((_, index) => (
          <Card
            key={index}
            className={`gap-0 overflow-hidden py-0 ${index > 0 ? "hidden md:flex" : ""}`}
          >
            <CardHeader className="p-0">
              <Skeleton className="aspect-video rounded-t-md rounded-b-none" />
            </CardHeader>
            <CardContent className="flex h-full flex-col gap-3 p-4">
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-4 w-1/4" />
              <div className="flex flex-col gap-2">
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
              <div className="flex items-center gap-2 pt-2">
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

  if (lockedPreview) {
    const visibleRows = Math.max(
      0,
      Math.min(lockedPreview.clearRows, rows.length),
    );
    const clearRows = rows.slice(0, visibleRows);
    const lockedRows = rows.slice(visibleRows);

    return (
      <div>
        {clearRows.map((row, rowIndex) =>
          renderGridRow(row, `preview-clear-${rowIndex}`),
        )}

        {lockedRows.length > 0 && (
          <div className="relative">
            <div
              inert
              aria-hidden="true"
              className="pointer-events-none select-none"
            >
              <div className="grid gap-4 pb-4 opacity-45 blur-sm md:grid-cols-2 lg:grid-cols-3">
                {lockedRows.flat().map((vehicle) => (
                  <Card
                    key={vehicle.id}
                    className="h-[480px] gap-0 overflow-hidden py-0"
                  >
                    <Skeleton className="aspect-video rounded-none" />
                    <CardContent className="space-y-4 p-4">
                      <Skeleton className="h-7 w-3/4" />
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-24 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>

            <div className="absolute inset-0 z-10 flex items-center justify-center p-4 sm:p-6">
              {lockedPreview.overlay}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="grid gap-4 pb-4 md:grid-cols-2 lg:grid-cols-3">
        {firstVehicles.map((vehicle) => (
          <VehicleCard key={vehicle.id} vehicle={vehicle} priority />
        ))}
      </div>
      <div
        ref={tailRef}
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
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              }}
            >
              {isLoaderRow ? (
                <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
                  Loading more vehicles...
                </div>
              ) : row ? (
                renderGridRow(row, `row-${virtualRow.index}`)
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
