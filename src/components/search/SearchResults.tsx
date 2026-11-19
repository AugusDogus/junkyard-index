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
  endOfResults?: ReactNode;
  staticPage?: boolean;
}

export function SearchResults({
  searchResult,
  sessionKey,
  isLoading,
  showMore,
  isLastPage = true,
  isFetchingNextPage = false,
  endOfResults,
  staticPage = false,
}: SearchResultsProps) {
  const isMobile = useIsMobile();
  const isMediumScreen = useIsMediumScreen();

  const getGridColumns = useCallback(() => {
    if (isMobile) return 1;
    if (isMediumScreen) return 2;
    return 3;
  }, [isMobile, isMediumScreen]);

  const columns = getGridColumns();

  // Keep the first cards in normal document flow, including SSR. The virtual
  // tail starts below them, so measuring the viewport never hides the LCP image.
  const firstVehicles = searchResult.vehicles.slice(0, 3);
  const tailRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [rowWidth, setRowWidth] = useState<number | null>(null);
  const restoration = useRef<ReturnType<
    typeof SearchScroll.prepareRestoration
  > | null>(null);
  useLayoutEffect(() => {
    const pending = SearchScroll.prepareRestoration();
    restoration.current = pending;
    return pending.cancel;
  }, []);
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
  }, [isLoading]);

  const rows = useMemo(() => {
    if (!searchResult.vehicles) return [];
    const result: SearchVehicle[][] = [];
    for (let i = 3; i < searchResult.vehicles.length; i += columns) {
      result.push(searchResult.vehicles.slice(i, i + columns));
    }
    return result;
  }, [searchResult.vehicles, columns]);

  const gapHeight = 16;
  const estimatedCardHeight =
    ((((rowWidth ?? 1000) - (columns - 1) * gapHeight) / columns) * 9) / 16 +
    360;
  const estimatedRowHeight = estimatedCardHeight + gapHeight;

  const rowCount = !isLastPage ? rows.length + 1 : rows.length;

  const rowVirtualizer = useWindowVirtualizer({
    count: rowCount,
    enabled: !staticPage && !isLoading,
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
      !staticPage &&
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
    staticPage,
    rows.length,
    isLastPage,
    isFetchingNextPage,
    showMore,
  ]);

  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [columns, estimatedRowHeight, rowVirtualizer]);

  useLayoutEffect(() => {
    if (
      !sessionKey ||
      isLoading ||
      rowWidth === null ||
      isMobile === null ||
      isMediumScreen === null
    )
      return;
    const pending = restoration.current;
    if (!pending?.pending()) return;
    const snapshot = SearchScroll.read(sessionKey);
    if (!snapshot || snapshot.rowSizes.length > rowCount) {
      pending.cancel();
      return;
    }
    snapshot.rowSizes.forEach((size, index) =>
      rowVirtualizer.resizeItem(index, size),
    );
    pending.start(snapshot.scrollY);
    return pending.cancel;
  }, [
    sessionKey,
    isLoading,
    rowWidth,
    isMobile,
    isMediumScreen,
    rowCount,
    rowVirtualizer,
  ]);

  useLayoutEffect(() => {
    if (!sessionKey || isLoading) return;
    const save = () =>
      SearchScroll.write(sessionKey, {
        width: window.innerWidth,
        scrollY: window.scrollY,
        rowSizes: rowVirtualizer.measurementsCache.map((row) => row.size),
      });
    window.addEventListener("pagehide", save);
    return () => {
      window.removeEventListener("pagehide", save);
    };
  }, [sessionKey, isLoading, rowVirtualizer]);

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

  if (staticPage) {
    return (
      <div>
        <div className="grid gap-4 pb-4 md:grid-cols-2 lg:grid-cols-3">
          {searchResult.vehicles.map((vehicle, index) => (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              priority={index < 3}
            />
          ))}
        </div>
        {endOfResults}
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
      {endOfResults}
    </div>
  );
}
