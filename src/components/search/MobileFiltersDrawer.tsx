"use client";

import { Filter } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/ui/drawer";
import { Separator } from "~/components/ui/separator";
import type { DataSource } from "~/lib/types";
import { MobileFilterContent } from "./MobileFilterContent";
import {
  AdvancedSearchButton,
  AdvancedSearchGroup,
} from "./SearchScopeFilters";
import type { SearchFilterOptions } from "./search-filter-options";

interface MobileFiltersDrawerProps {
  onAdvancedSearch: () => void;
  /** Arrival, distance and yard type, shown above the other filters. */
  scope?: ReactNode;
  activeFilterCount: number;
  /** What the search covers with no filters, such as "Self-service yards". */
  defaultScopeLabel: string;
  /** The current result count, or null while it loads. */
  resultCount: number | null;
  clearAllFilters: () => void;
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
  sources: DataSource[];
  yearRange: [number, number];
  filterOptions: SearchFilterOptions;
  filterOptionsFeedback?: ReactNode;
  onMakesChange: (makes: string[]) => void;
  onColorsChange: (colors: string[]) => void;
  onStatesChange: (states: string[]) => void;
  onSalvageYardsChange: (salvageYards: string[]) => void;
  onSourcesChange: (sources: DataSource[]) => void;
  onYearRangeChange: (range: [number, number]) => void;
  yearRangeLimits?: {
    min: number;
    max: number;
  };
  canUseAdvancedFilters: boolean;
}

export function MobileFiltersDrawer({
  onAdvancedSearch,
  scope,
  activeFilterCount,
  defaultScopeLabel,
  resultCount,
  clearAllFilters,
  makes,
  colors,
  states,
  salvageYards,
  sources,
  yearRange,
  filterOptions,
  filterOptionsFeedback,
  onMakesChange,
  onColorsChange,
  onStatesChange,
  onSalvageYardsChange,
  onSourcesChange,
  onYearRangeChange,
  yearRangeLimits,
  canUseAdvancedFilters,
}: MobileFiltersDrawerProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openAdvancedOnClose = useRef(false);
  return (
    <Drawer autoFocus>
      <DrawerTrigger asChild>
        <Button ref={triggerRef} variant="outline" className="gap-1.5">
          <Filter data-icon="inline-start" />
          {/* On narrow phones the label gives way to the icon and count, so
              the toolbar keeps every control on one legible row. */}
          <span
            className={
              activeFilterCount > 0
                ? "max-[389px]:sr-only"
                : "max-[359px]:sr-only"
            }
          >
            Filters
          </span>
          {activeFilterCount > 0 && (
            <span className="tabular-nums">({activeFilterCount})</span>
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent
        onCloseAutoFocus={(event) => {
          if (!openAdvancedOnClose.current) return;
          event.preventDefault();
          openAdvancedOnClose.current = false;
          // The drawer's Advanced button is about to unmount. Use its stable
          // trigger as the return target before opening the next dialog.
          triggerRef.current?.focus();
          onAdvancedSearch();
        }}
      >
        <DrawerHeader className="group-data-[vaul-drawer-direction=bottom]/drawer-content:text-left">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-1">
              <DrawerTitle className="text-lg font-medium">Filters</DrawerTitle>
              <DrawerDescription className="tabular-nums">
                {activeFilterCount > 0
                  ? `${activeFilterCount} active`
                  : defaultScopeLabel}
              </DrawerDescription>
            </div>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                Clear all
              </Button>
            )}
          </div>
        </DrawerHeader>
        <Separator />
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          {scope && <div className="border-b py-4">{scope}</div>}
          <MobileFilterContent
            makes={makes}
            colors={colors}
            states={states}
            salvageYards={salvageYards}
            sources={sources}
            yearRange={yearRange}
            filterOptions={filterOptions}
            filterOptionsFeedback={filterOptionsFeedback}
            onMakesChange={onMakesChange}
            onColorsChange={onColorsChange}
            onStatesChange={onStatesChange}
            onSalvageYardsChange={onSalvageYardsChange}
            onSourcesChange={onSourcesChange}
            onYearRangeChange={onYearRangeChange}
            yearRangeLimits={yearRangeLimits}
            canUseAdvancedFilters={canUseAdvancedFilters}
          />
          <div className="border-t py-4">
            <AdvancedSearchGroup locked={!canUseAdvancedFilters}>
              <DrawerClose asChild>
                <AdvancedSearchButton
                  locked={!canUseAdvancedFilters}
                  onClick={() => {
                    openAdvancedOnClose.current = true;
                  }}
                />
              </DrawerClose>
            </AdvancedSearchGroup>
          </div>
        </div>
        <Separator />
        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DrawerClose asChild>
            <Button className="h-11 w-full tabular-nums">
              {resultCount === null
                ? "Show results"
                : `Show ${resultCount.toLocaleString()} ${resultCount === 1 ? "vehicle" : "vehicles"}`}
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
