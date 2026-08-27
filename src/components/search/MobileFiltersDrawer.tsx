"use client";

import { Filter } from "lucide-react";
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
import type { SearchFilterOptions } from "./search-filter-options";

interface MobileFiltersDrawerProps {
  activeFilterCount: number;
  clearAllFilters: () => void;
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
  sources: DataSource[];
  yearRange: [number, number];
  filterOptions: SearchFilterOptions;
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
  iconOnly?: boolean;
}

export function MobileFiltersDrawer({
  activeFilterCount,
  clearAllFilters,
  makes,
  colors,
  states,
  salvageYards,
  sources,
  yearRange,
  filterOptions,
  onMakesChange,
  onColorsChange,
  onStatesChange,
  onSalvageYardsChange,
  onSourcesChange,
  onYearRangeChange,
  yearRangeLimits,
  canUseAdvancedFilters,
  iconOnly,
}: MobileFiltersDrawerProps) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button
          variant="outline"
          size={iconOnly ? "sm" : "default"}
          aria-label={
            iconOnly
              ? `Filters${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`
              : undefined
          }
        >
          <Filter data-icon="inline-start" />
          {!iconOnly && "Filters"}
          {activeFilterCount > 0 && (
            <span className="tabular-nums">({activeFilterCount})</span>
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="text-left">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DrawerTitle className="text-lg font-semibold">
                Filters
              </DrawerTitle>
              <DrawerDescription className="mt-1 tabular-nums">
                {activeFilterCount > 0
                  ? `${activeFilterCount} active`
                  : "Showing all inventory"}
              </DrawerDescription>
            </div>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                Clear
              </Button>
            )}
          </div>
        </DrawerHeader>
        <Separator />
        <div className="min-h-0 flex-1 overflow-y-auto px-4">
          <MobileFilterContent
            makes={makes}
            colors={colors}
            states={states}
            salvageYards={salvageYards}
            sources={sources}
            yearRange={yearRange}
            filterOptions={filterOptions}
            onMakesChange={onMakesChange}
            onColorsChange={onColorsChange}
            onStatesChange={onStatesChange}
            onSalvageYardsChange={onSalvageYardsChange}
            onSourcesChange={onSourcesChange}
            onYearRangeChange={onYearRangeChange}
            yearRangeLimits={yearRangeLimits}
            canUseAdvancedFilters={canUseAdvancedFilters}
          />
        </div>
        <Separator />
        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DrawerClose asChild>
            <Button className="h-11 w-full">Show results</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
