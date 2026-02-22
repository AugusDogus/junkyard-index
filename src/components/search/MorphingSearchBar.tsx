"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { useSearchBox } from "react-instantsearch";
import { useIsMobile } from "~/hooks/use-media-query";

const DEBOUNCE_MS = 300;

export const MorphingSearchBar = forwardRef<HTMLDivElement>(
  function MorphingSearchBar(_, ref) {
    const { query, refine } = useSearchBox();
    const [inputValue, setInputValue] = useState(query);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const placeholderRef = useRef<HTMLDivElement>(null);
    const isMobile = useIsMobile();
    const [style, setStyle] = useState<{
      top: number;
      left: number;
      width: number;
      height: number;
      progress: number;
    } | null>(null);

    // Sync local input when Algolia query changes externally (e.g. URL routing).
    // Skip sync if difference is only trailing whitespace (user still typing).
    useEffect(() => {
      if (query !== inputValueRef.current.trim()) {
        setInputValue(query);
      }
    }, [query]);

    // Also sync when Next.js navigates (e.g. clicking logo to /search clears URL)
    // Algolia's history router doesn't detect pushState, so we watch URL params directly
    const searchParams = useSearchParams();
    const urlQuery = searchParams.get("q") ?? "";
    const inputValueRef = useRef(inputValue);
    inputValueRef.current = inputValue;
    useEffect(() => {
      if (!urlQuery && inputValueRef.current) {
        setInputValue("");
        refine("");
      }
    }, [urlQuery]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Clear pending debounce on unmount
    useEffect(() => {
      return () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
      };
    }, []);

    // Debounced refine — updates local state immediately, sends trimmed value to Algolia after delay
    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setInputValue(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(
          () => refine(value.trim()),
          DEBOUNCE_MS,
        );
      },
      [refine],
    );

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (debounceRef.current) clearTimeout(debounceRef.current);
          refine(inputValueRef.current.trim());
        }
      },
      [refine],
    );

    const handleSubmit = useCallback(
      (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = inputValueRef.current.trim();
        if (trimmed) {
          if (debounceRef.current) clearTimeout(debounceRef.current);
          refine(trimmed);
        }
      },
      [refine],
    );

    // Production-matching search input with lucide Search icon, no clear button
    const searchInput = (
      <div className="relative h-10 w-full text-sm">
        <label className="sr-only" htmlFor="search">
          Search for vehicles
        </label>
        <input
          id="search"
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Enter year, make, model (e.g., '2018 Honda Civic')"
          className="file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background flex h-full w-full min-w-0 rounded-md border px-3 py-1 pl-10 text-base shadow-sm outline-none focus-visible:ring-[3px] sm:text-sm"
        />
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 opacity-50 select-none" />
      </div>
    );

    // Mobile: static search bar
    if (isMobile) {
      return (
        <div ref={ref} className="mb-6">
          <form onSubmit={handleSubmit}>{searchInput}</form>
        </div>
      );
    }

    // Desktop: morphing search bar (matches production layout exactly)
    return (
      <div ref={ref} className="mb-6">
        <div ref={placeholderRef} className="h-10 w-full">
          {!style && <form onSubmit={handleSubmit}>{searchInput}</form>}
        </div>
        {/* Try suggestions — hidden on mobile, matches production layout */}
        <div className="text-muted-foreground mt-2 hidden text-xs sm:flex sm:items-center sm:gap-3">
          <span>Try: </span>
          {["Honda Civic", "2020 Toyota", "Ford F-150"].map((term) => (
            <button
              key={term}
              type="button"
              className="text-primary cursor-pointer underline hover:no-underline"
              onClick={() => {
                setInputValue(term);
                if (debounceRef.current) clearTimeout(debounceRef.current);
                refine(term);
              }}
            >
              {term}
            </button>
          ))}
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
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  style.progress > 0.5
                    ? "Search vehicles..."
                    : "Enter year, make, model (e.g., '2018 Honda Civic')"
                }
                className="file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background flex h-full w-full min-w-0 rounded-md border px-3 py-1 pl-10 text-base shadow-sm outline-none focus-visible:ring-[3px] md:text-sm"
              />
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 opacity-50 select-none" />
            </div>
          </form>
        )}
      </div>
    );
  },
);
