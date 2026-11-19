"use client";

import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { YardLinks } from "./YardLinks";
import type { MapYard } from "./yard-map-data";
import { YardPath } from "~/lib/yard-path";
import { cn } from "~/lib/utils";

export const YardDirectory = memo(function YardDirectory({
  yards,
  selected,
  onSelect,
}: {
  yards: MapYard[];
  selected: MapYard | null;
  onSelect: (yard: MapYard) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const focusPending = useRef(false);
  const activeButton = useRef<HTMLButtonElement>(null);
  const activeIndex = Math.max(
    0,
    yards.findIndex((yard) => YardPath.key(yard) === focusedKey),
  );
  const virtualizer = useVirtualizer({
    count: yards.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => {
      const yard = yards[index];
      return yard ? YardPath.key(yard) : index;
    },
    estimateSize: () => 132,
    initialRect: { width: 360, height: 256 },
    overscan: 3,
    // Keep the active row mounted, including its contact links and focus.
    rangeExtractor: (range) =>
      [...new Set([...defaultRangeExtractor(range), activeIndex])].sort(
        (a, b) => a - b,
      ),
  });

  useLayoutEffect(() => {
    if (focusPending.current && activeButton.current) {
      activeButton.current.focus({ preventScroll: true });
      focusPending.current = false;
    }
  });

  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label="Yard directory results"
      aria-description="Use Up and Down to move between yards, Home and End for the first and last yard, Enter to show a yard on the map, and Tab for the active yard's links."
      className="max-h-64 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain lg:max-h-none"
      onKeyDown={(event) => {
        const destinations: Record<string, number> = {
          ArrowDown: Math.min(yards.length - 1, activeIndex + 1),
          ArrowUp: Math.max(0, activeIndex - 1),
          Home: 0,
          End: yards.length - 1,
        };
        const next = destinations[event.key];
        if (next === undefined) return;
        const yard = yards[next];
        if (!yard) return;
        event.preventDefault();
        focusPending.current = true;
        setFocusedKey(YardPath.key(yard));
        virtualizer.scrollToIndex(next, { align: "auto" });
      }}
    >
      {yards.length === 0 ? (
        <p className="text-ink-2 p-5 text-sm">
          No matching yards. Try another city or state abbreviation.
        </p>
      ) : (
        <div
          className="relative w-full"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const yard = yards[item.index];
            if (!yard) return null;
            const active = item.index === activeIndex;
            return (
              <div
                key={item.key}
                ref={virtualizer.measureElement}
                data-index={item.index}
                role="listitem"
                aria-posinset={item.index + 1}
                aria-setsize={yards.length}
                style={{ transform: `translateY(${item.start}px)` }}
                onFocusCapture={() => setFocusedKey(YardPath.key(yard))}
                className={cn(
                  "board-step border-rule hover:bg-paper-2 focus-within:bg-paper-2 absolute top-0 left-0 w-full min-w-0 border-b",
                  selected === yard && "bg-paper-2",
                )}
              >
                <button
                  ref={active ? activeButton : undefined}
                  type="button"
                  tabIndex={active ? 0 : -1}
                  onClick={() => onSelect(yard)}
                  aria-pressed={selected === yard}
                  className="focus-visible:after:outline-focus block w-full px-4 pt-3 pb-1 text-left outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-solid"
                >
                  <span className="block min-w-0">
                    <span
                      className={cn(
                        "block truncate text-[0.9375rem] font-medium",
                        selected === yard && "text-signal font-extrabold",
                      )}
                      title={yard.name}
                    >
                      {yard.name}
                    </span>
                    <span className="text-ink-3 mt-0.5 flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate">
                        {yard.city}, {yard.state}
                      </span>
                      <span className="text-ink shrink-0 whitespace-nowrap">
                        <span className="font-extrabold">
                          {yard.vehicleCount.toLocaleString("en-US")}
                        </span>{" "}
                        {yard.vehicleCount === 1 ? "vehicle" : "vehicles"}
                      </span>
                    </span>
                  </span>
                </button>
                <div className="px-4 pb-2">
                  <YardLinks yard={yard} tabIndex={active ? 0 : -1} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
