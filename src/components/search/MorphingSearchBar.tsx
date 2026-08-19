"use client";

import { Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchBox } from "react-instantsearch";
import { Badge } from "~/components/ui/badge";
import { useSearchVisibility } from "~/context/SearchVisibilityContext";
import { useIsMobile } from "~/hooks/use-media-query";
import { cn } from "~/lib/utils";
import { VinPattern } from "~/lib/vin-pattern";

const DEBOUNCE_MS = 300;

interface MorphingSearchBarProps {
  vinPattern: string;
  vinPatternPreview: boolean;
  vinPatternSearchReady: boolean;
  onSearchModeChange: (value: {
    query: string | null;
    vinPattern: string | null;
  }) => Promise<void>;
}

export const MorphingSearchBar = forwardRef<
  HTMLDivElement,
  MorphingSearchBarProps
>(function MorphingSearchBar(
  { vinPattern, vinPatternPreview, vinPatternSearchReady, onSearchModeChange },
  ref,
) {
  const { query, refine } = useSearchBox();
  const refineRef = useRef(refine);
  refineRef.current = refine;
  const committedValue =
    vinPatternSearchReady && vinPattern ? vinPattern : query;
  const [inputValue, setInputValue] = useState(committedValue);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committingValueRef = useRef<string | null>(null);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const mobileFormRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const { setSearchBarOffscreen, registerSearchElement } =
    useSearchVisibility();
  const [style, setStyle] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    progress: number;
  } | null>(null);

  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  // Sync local input when search state changes externally (e.g. URL routing).
  // Skip sync if difference is only trailing whitespace (user still typing).
  useEffect(() => {
    if (
      committingValueRef.current !== null &&
      committedValue !== committingValueRef.current
    ) {
      return;
    }
    if (committedValue === committingValueRef.current) {
      committingValueRef.current = null;
    }
    if (committedValue !== inputValueRef.current.trim()) {
      setInputValue(committedValue);
    }
  }, [committedValue]);

  // Also sync when Next.js navigates (e.g. clicking logo to /search clears URL)
  // Algolia's history router doesn't detect pushState, so we watch URL params directly
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";
  const urlVinPattern = searchParams.get("vin") ?? "";
  useEffect(() => {
    if (committingValueRef.current !== null) return;
    if (!urlQuery && !urlVinPattern && inputValueRef.current) {
      setInputValue("");
      void onSearchModeChange({ query: null, vinPattern: null });
      refine("");
    }
  }, [urlQuery, urlVinPattern]); // eslint-disable-line react-hooks/exhaustive-deps

  const isVinCandidate =
    vinPatternSearchReady && VinPattern.isSearchCandidate(inputValue);
  const parsedVinPattern = useMemo(
    () => (isVinCandidate ? VinPattern.parse(inputValue) : null),
    [inputValue, isVinCandidate],
  );
  const vinPatternError =
    parsedVinPattern &&
    !parsedVinPattern.success &&
    (parsedVinPattern.error.type !== "wrong_length" ||
      parsedVinPattern.error.positions > VinPattern.length)
      ? VinPattern.errorMessage(parsedVinPattern.error)
      : parsedVinPattern?.success &&
          !VinPattern.toAlgoliaFilter(parsedVinPattern.data)
        ? "Add at least one known VIN character."
        : undefined;
  const vinPatternFeedback = (() => {
    if (!parsedVinPattern) return null;
    if (vinPatternError) return vinPatternError;
    if (!parsedVinPattern.success) {
      return parsedVinPattern.error.type === "wrong_length" &&
        parsedVinPattern.error.positions <= VinPattern.length
        ? `${parsedVinPattern.error.positions} of ${VinPattern.length} VIN positions. Use * for anything unknown.`
        : VinPattern.errorMessage(parsedVinPattern.error);
    }
    return inputValue.includes("*") || inputValue.includes("[")
      ? "VIN pattern ready."
      : "Exact VIN detected.";
  })();

  useEffect(() => {
    if (!isMobile) return;
    const el = mobileFormRef.current;
    if (!el) return;

    registerSearchElement(el);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) {
          setSearchBarOffscreen(!entry.isIntersecting);
        }
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      registerSearchElement(null);
      setSearchBarOffscreen(false);
    };
  }, [isMobile, registerSearchElement, setSearchBarOffscreen]);

  useEffect(() => {
    if (isMobile) return;

    const updatePosition = () => {
      const placeholder = placeholderRef.current;
      if (!placeholder) return;

      const rect = placeholder.getBoundingClientRect();
      const scrollY = window.scrollY;

      const logo = document.querySelector("header [data-brand-link]");
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

  const commitSearchValue = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      committingValueRef.current = trimmed;
      if (vinPatternSearchReady && VinPattern.isSearchCandidate(trimmed)) {
        await onSearchModeChange({ query: null, vinPattern: trimmed });
        return;
      }

      if (vinPattern) {
        await onSearchModeChange({
          query: trimmed || null,
          vinPattern: null,
        });
        return;
      }
      refineRef.current(trimmed);
    },
    [onSearchModeChange, vinPattern, vinPatternSearchReady],
  );

  // Update local state immediately, then commit the appropriate search mode.
  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setInputValue(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(
        () => void commitSearchValue(value),
        DEBOUNCE_MS,
      );
    },
    [commitSearchValue],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        void commitSearchValue(inputValueRef.current);
      }
    },
    [commitSearchValue],
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      void commitSearchValue(inputValueRef.current);
    },
    [commitSearchValue],
  );

  const renderSearchInput = (placeholder: string) => (
    <div className="relative h-10 w-full text-sm">
      <label className="sr-only" htmlFor="search">
        Search for vehicles by year, make, model, or VIN
      </label>
      <input
        id="search"
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-describedby={
          vinPatternFeedback ? "search-vin-feedback" : undefined
        }
        aria-invalid={vinPatternError ? true : undefined}
        className={cn(
          "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background flex h-full w-full min-w-0 rounded-md border px-3 py-1 pl-10 text-base shadow-sm outline-none focus-visible:ring-[3px] sm:text-sm",
          vinPatternError &&
            "border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20",
        )}
      />
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 opacity-50 select-none" />
    </div>
  );

  const renderVinFeedback = (className?: string, floating = false) =>
    vinPatternFeedback ? (
      <div
        id="search-vin-feedback"
        role={vinPatternError ? "alert" : "status"}
        aria-live="polite"
        className={cn(
          "flex items-center gap-2 text-xs text-pretty",
          vinPatternError ? "text-destructive" : "text-muted-foreground",
          floating &&
            "bg-background min-w-64 rounded-md border px-2 py-1.5 shadow-sm",
          className,
        )}
      >
        <span>{vinPatternFeedback}</span>
        {vinPatternPreview && (
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            UI preview
          </Badge>
        )}
      </div>
    ) : null;

  if (isMobile) {
    return (
      <div ref={ref} className="mb-6">
        <div ref={mobileFormRef}>
          <form onSubmit={handleSubmit}>
            {renderSearchInput("Search year, make, model, or VIN")}
            {renderVinFeedback("mt-2 px-1")}
          </form>
        </div>
      </div>
    );
  }

  // Desktop: morphing search bar (matches production layout exactly)
  return (
    <div ref={ref} className="mb-6">
      <div ref={placeholderRef} className="h-10 w-full">
        {!style && (
          <form onSubmit={handleSubmit}>
            {renderSearchInput("Search year, make, model, or VIN")}
            {renderVinFeedback("mt-2 px-1")}
          </form>
        )}
      </div>
      {/* Try suggestions — hidden on mobile, matches production layout */}
      <div
        className={cn(
          "text-muted-foreground hidden text-xs sm:flex sm:items-center sm:gap-3",
          vinPatternFeedback ? "mt-7" : "mt-2",
        )}
      >
        <span>Try: </span>
        {["Honda Civic", "2020 Toyota", "Ford F-150"].map((term) => (
          <button
            key={term}
            type="button"
            className="text-primary cursor-pointer underline hover:no-underline"
            onClick={() => {
              setInputValue(term);
              if (debounceRef.current) clearTimeout(debounceRef.current);
              void commitSearchValue(term);
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
          {renderSearchInput(
            style.progress > 0.5
              ? "Search vehicles or VIN..."
              : "Search year, make, model, or VIN",
          )}
          {renderVinFeedback(
            "absolute top-full mt-1 w-full",
            style.progress > 0.5,
          )}
        </form>
      )}
    </div>
  );
});
