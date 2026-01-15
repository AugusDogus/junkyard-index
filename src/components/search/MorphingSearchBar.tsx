"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { useSearchVisibility } from "~/context/SearchVisibilityContext";
import { useIsMobile } from "~/hooks/use-media-query";

export const MorphingSearchBar = forwardRef<HTMLDivElement>(
  function MorphingSearchBar(_, ref) {
    const { searchStateRef } = useSearchVisibility();
    const placeholderRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();
    const [style, setStyle] = useState<{
      top: number;
      left: number;
      width: number;
      height: number;
      progress: number;
    } | null>(null);
    const searchState = searchStateRef.current;

    useEffect(() => {
      // On mobile, don't set up morphing - just render static
      if (isMobile) {
        return;
      }

      const updatePosition = () => {
        const placeholder = placeholderRef.current;
        if (!placeholder) return;

        const rect = placeholder.getBoundingClientRect();
        const scrollY = window.scrollY;
        
        const logo = document.querySelector('header a[href="/search"]');
        const logoRect = logo?.getBoundingClientRect();
        
        // Target position in header
        const headerTop = logoRect ? logoRect.top + (logoRect.height - 32) / 2 : 16;
        const headerLeft = logoRect ? logoRect.right + 16 : 200;
        const headerWidth = 350;
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
          progress = (scrollY - transitionStart) / (transitionEnd - transitionStart);
        }
        
        const lerp = (start: number, end: number, t: number) => start + (end - start) * t;
        
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

    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        searchState?.onChange(e.target.value);
      },
      [searchState],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          searchState?.onSearch();
        }
      },
      [searchState],
    );

    const handleSubmit = useCallback(
      (e: React.FormEvent) => {
        e.preventDefault();
        if (searchState?.query.trim()) {
          searchState.onSearch();
        }
      },
      [searchState],
    );

    // Shared input component to avoid duplication
    const searchInput = (
      <div className="relative h-10 w-full text-sm">
        <label className="sr-only" htmlFor="search">
          Search for vehicles
        </label>
        <input
          id="search"
          type="text"
          value={searchState?.query ?? ""}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Enter year, make, model (e.g., '2018 Honda Civic')"
          className="file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background flex h-full w-full min-w-0 rounded-md border px-3 py-1 pl-10 text-base shadow-sm outline-none focus-visible:ring-[3px] sm:text-sm"
        />
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 select-none opacity-50" />
      </div>
    );

    // Mobile: render static search bar (no morphing)
    if (isMobile) {
      return (
        <div ref={ref} className="mb-6">
          <form onSubmit={handleSubmit}>
            {searchInput}
          </form>
        </div>
      );
    }

    // Desktop: render morphing search bar
    // Show static version until style is calculated to avoid flash of empty content
    return (
      <div ref={ref} className="mb-6">
        <div ref={placeholderRef} className="h-10 w-full">
          {/* Show static input in placeholder until morphing style is ready */}
          {!style && (
            <form onSubmit={handleSubmit}>
              {searchInput}
            </form>
          )}
        </div>
        {style && (
          <form
            onSubmit={handleSubmit}
            className="fixed z-[60]"
            style={{
              top: style.top,
              left: style.left,
              width: style.width,
              height: style.height,
            }}
          >
            <div className="relative h-full w-full text-sm">
              <label className="sr-only" htmlFor="search">
                Search for vehicles
              </label>
              <input
                id="search"
                type="text"
                value={searchState?.query ?? ""}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={style.progress > 0.5 ? "Search vehicles..." : "Enter year, make, model (e.g., '2018 Honda Civic')"}
                className="file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background flex h-full w-full min-w-0 rounded-md border px-3 py-1 pl-10 text-base shadow-sm outline-none focus-visible:ring-[3px] md:text-sm"
              />
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 select-none opacity-50" />
            </div>
          </form>
        )}
        
        {/* Hidden on mobile - mobile has pill buttons in empty state instead */}
        <div className="text-muted-foreground mt-2 hidden text-xs sm:block">
          <span>Try: </span>
          <Link
            href="/search?q=Honda+Civic"
            className="text-primary mr-3 underline hover:no-underline"
          >
            Honda Civic
          </Link>
          <Link
            href="/search?q=2020+Toyota"
            className="text-primary mr-3 underline hover:no-underline"
          >
            2020 Toyota
          </Link>
          <Link
            href="/search?q=Ford+F-150"
            className="text-primary underline hover:no-underline"
          >
            Ford F-150
          </Link>
        </div>
      </div>
    );
  },
);
