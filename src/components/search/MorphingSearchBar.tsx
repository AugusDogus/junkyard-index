"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import { SearchBox } from "react-instantsearch";
import { useIsMobile } from "~/hooks/use-media-query";

/**
 * Module-level debounced queryHook following Algolia's official pattern.
 * Defined outside the component so the reference is stable across renders.
 * @see https://algolia.com/doc/guides/building-search-ui/going-further/improve-performance/react
 */
let debounceTimerId: ReturnType<typeof setTimeout> | undefined;
const DEBOUNCE_MS = 300;

function queryHook(query: string, search: (query: string) => void) {
  clearTimeout(debounceTimerId);
  debounceTimerId = setTimeout(() => search(query), DEBOUNCE_MS);
}

// Shared class names for the Algolia SearchBox input
const searchBoxClassNames = {
  root: "relative w-full",
  form: "relative w-full",
  input:
    "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background flex h-full w-full min-w-0 rounded-md border px-3 py-1 pl-10 text-base shadow-sm outline-none focus-visible:ring-[3px] sm:text-sm",
  submit: "absolute top-1/2 left-3 -translate-y-1/2 opacity-50 [&>svg]:size-4",
  reset: "absolute top-1/2 right-3 -translate-y-1/2 opacity-50 [&>svg]:size-4",
  loadingIndicator: "hidden",
};

export const MorphingSearchBar = forwardRef<HTMLDivElement>(
  function MorphingSearchBar(_, ref) {
    const placeholderRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();
    const [style, setStyle] = useState<{
      top: number;
      left: number;
      width: number;
      height: number;
      progress: number;
    } | null>(null);

    useEffect(() => {
      if (isMobile) return;

      const updatePosition = () => {
        const placeholder = placeholderRef.current;
        if (!placeholder) return;

        const rect = placeholder.getBoundingClientRect();
        const scrollY = window.scrollY;

        const logo = document.querySelector('header a[href="/search"]');
        const logoRect = logo?.getBoundingClientRect();

        const filterBar = document.querySelector("[data-morphing-filter-bar]");
        const filterBarRect = filterBar?.getBoundingClientRect();

        const headerTop = logoRect
          ? logoRect.top + (logoRect.height - 32) / 2
          : 16;
        const headerLeft = logoRect ? logoRect.right + 16 : 200;

        const maxHeaderWidth = filterBarRect
          ? filterBarRect.left - headerLeft - 24
          : window.innerWidth - headerLeft - 200;

        const headerWidth = Math.max(150, Math.min(350, maxHeaderWidth));
        const headerHeight = 32;

        const startTop = rect.top + scrollY;
        const startLeft = rect.left;
        const startWidth = rect.width;
        const startHeight = 40;

        const transitionStart = startTop - 80;
        const transitionEnd = startTop - headerTop;

        let progress = 0;
        if (scrollY <= transitionStart) {
          progress = 0;
        } else if (scrollY >= transitionEnd) {
          progress = 1;
        } else {
          progress =
            (scrollY - transitionStart) / (transitionEnd - transitionStart);
        }

        const lerp = (start: number, end: number, t: number) =>
          start + (end - start) * t;

        setStyle({
          top: lerp(startTop - scrollY, headerTop, progress),
          left: lerp(startLeft, headerLeft, progress),
          width: lerp(startWidth, headerWidth, progress),
          height: lerp(startHeight, headerHeight, progress),
          progress,
        });
      };

      updatePosition();
      window.addEventListener("scroll", updatePosition, { passive: true });
      window.addEventListener("resize", updatePosition, { passive: true });

      return () => {
        window.removeEventListener("scroll", updatePosition);
        window.removeEventListener("resize", updatePosition);
      };
    }, [isMobile]);

    // Mobile: static search bar
    if (isMobile) {
      return (
        <div ref={ref} className="mb-6">
          <div className="h-10">
            <SearchBox
              queryHook={queryHook}
              placeholder="Enter year, make, model (e.g., '2018 Honda Civic')"
              classNames={searchBoxClassNames}
            />
          </div>
        </div>
      );
    }

    // Desktop: morphing search bar
    return (
      <div ref={ref} className="mb-6">
        <div ref={placeholderRef} className="h-10 w-full">
          {!style && (
            <SearchBox
              queryHook={queryHook}
              placeholder="Enter year, make, model (e.g., '2018 Honda Civic')"
              classNames={searchBoxClassNames}
            />
          )}
        </div>
        {style && (
          <div
            className="fixed z-[60]"
            style={{
              top: style.top,
              left: style.left,
              width: style.width,
              height: style.height,
            }}
          >
            <SearchBox
              queryHook={queryHook}
              placeholder={
                style.progress > 0.5
                  ? "Search vehicles..."
                  : "Enter year, make, model (e.g., '2018 Honda Civic')"
              }
              classNames={searchBoxClassNames}
            />
          </div>
        )}
      </div>
    );
  },
);
