"use client";

import {
  ArrowUpDown,
  Calendar,
  Filter,
  MapPin,
} from "lucide-react";
import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useIsMediumScreen } from "~/hooks/use-media-query";
import { SavedSearchesDropdown } from "./SavedSearchesDropdown";
import { SaveSearchDialog } from "./SaveSearchDialog";

interface MorphingFilterBarProps {
  query: string;
  sortBy: string;
  onSortChange: (value: string) => void;
  activeFilterCount: number;
  showFilters: boolean;
  onToggleFilters: () => void;
  isLoggedIn?: boolean;
  filters: {
    makes: string[];
    colors: string[];
    states: string[];
    salvageYards: string[];
    minYear: number;
    maxYear: number;
    sortBy: string;
  };
  autoOpenSaveDialog?: boolean;
  onAutoOpenHandled?: () => void;
  disabled?: boolean;
  loading?: boolean;
}

export const MorphingFilterBar = forwardRef<HTMLDivElement, MorphingFilterBarProps>(
  function MorphingFilterBar(
    {
      query,
      sortBy,
      onSortChange,
      activeFilterCount,
      onToggleFilters,
      isLoggedIn,
      filters,
      autoOpenSaveDialog,
      onAutoOpenHandled,
      disabled,
      loading,
    },
    ref,
  ) {
    const placeholderRef = useRef<HTMLDivElement>(null);
    const [style, setStyle] = useState<{
      top: number;
      right: number;
      progress: number;
    } | null>(null);

    useEffect(() => {
      const updatePosition = () => {
        const placeholder = placeholderRef.current;
        if (!placeholder) return;

        const rect = placeholder.getBoundingClientRect();
        const scrollY = window.scrollY;
        
        const headerButtonsContainer = document.querySelector('header > div > div > div:last-child');
        const buttonsRect = headerButtonsContainer?.getBoundingClientRect();
        
        const headerTop = buttonsRect ? buttonsRect.top : 16;
        const headerRight = buttonsRect ? (window.innerWidth - buttonsRect.left + 16) : 120;
        
        const startTop = rect.top + scrollY;
        const startRight = window.innerWidth - rect.right;
        
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
          right: lerp(startRight, headerRight, progress),
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
    }, []);

    const getSortIcon = useCallback((sortOption: string) => {
      switch (sortOption) {
        case "newest":
        case "oldest":
          return Calendar;
        case "year-desc":
        case "year-asc":
          return ArrowUpDown;
        case "distance":
          return MapPin;
        default:
          return ArrowUpDown;
      }
    }, []);

    const SortIcon = getSortIcon(sortBy);
    const isMediumScreen = useIsMediumScreen();
    // Compact when scrolled to save space
    const isCompact = style ? style.progress > 0.5 : false;
    // Icon-only mode on medium screens (768-1023px) to fit in header
    const isIconOnly = isMediumScreen;

    const skeletonContent = (
      <div className={`flex items-center ${isCompact || isIconOnly ? "gap-1.5" : "gap-2 sm:gap-4"}`}>
        {isLoggedIn && <Skeleton className={isCompact || isIconOnly ? "h-8 w-8" : "h-9 w-[88px]"} />}
        <Skeleton className={isCompact || isIconOnly ? "h-8 w-8" : "h-9 w-[110px]"} />
        <Skeleton className={isCompact || isIconOnly ? "h-8 w-8" : "h-9 w-[130px]"} />
        <Skeleton className={isCompact || isIconOnly ? "h-8 w-8" : "h-9 w-[90px]"} />
      </div>
    );

    const filterContent = (
      <div className={`flex items-center whitespace-nowrap transition-all duration-100 ${isCompact || isIconOnly ? "gap-1.5" : "gap-2 sm:gap-4"}`}>
        {isLoggedIn && <SavedSearchesDropdown compact={isCompact} iconOnly={isIconOnly} />}
        <SaveSearchDialog
          query={query}
          filters={filters}
          disabled={disabled}
          isLoggedIn={isLoggedIn}
          autoOpen={autoOpenSaveDialog}
          onAutoOpenHandled={onAutoOpenHandled}
          compact={isCompact}
          iconOnly={isIconOnly}
        />

        <Select value={sortBy} onValueChange={onSortChange}>
          <SelectTrigger size={isCompact || isIconOnly ? "sm" : "default"} className={`w-fit transition-all duration-100 ${isCompact || isIconOnly ? "text-xs" : ""}`}>
            <div className="flex items-center gap-2">
              <SortIcon className={`text-muted-foreground ${isCompact || isIconOnly ? "h-3.5 w-3.5" : "h-4 w-4"}`} />
              {!isIconOnly && <SelectValue />}
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest First</SelectItem>
            <SelectItem value="oldest">Oldest First</SelectItem>
            <SelectItem value="year-desc">Year (High to Low)</SelectItem>
            <SelectItem value="year-asc">Year (Low to High)</SelectItem>
            <SelectItem value="distance">Distance (Nearest)</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size={isCompact || isIconOnly ? "sm" : "default"}
          className={`flex items-center gap-2 bg-transparent transition-all duration-100 ${isCompact || isIconOnly ? "h-8 text-xs" : ""}`}
          onClick={onToggleFilters}
        >
          <Filter className={isCompact || isIconOnly ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {!isIconOnly && "Filters"}
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className={isCompact || isIconOnly ? "text-[10px]" : "text-xs"}>
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </div>
    );

    const content = loading ? skeletonContent : filterContent;

    return (
      <div ref={ref}>
        <div ref={placeholderRef} className="h-9">
          <div className="invisible">{content}</div>
        </div>
        {style && (
          <div
            className="fixed z-[60]"
            data-morphing-filter-bar
            style={{
              top: style.top,
              right: style.right,
            }}
          >
            {content}
          </div>
        )}
      </div>
    );
  },
);
