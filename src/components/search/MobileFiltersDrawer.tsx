"use client";

import { Filter } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "~/components/ui/drawer";
import type { DataSource } from "~/lib/types";
import { SidebarContent } from "./SidebarContent";

interface FilterOptions {
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
}

interface MobileFiltersDrawerProps {
  activeFilterCount: number;
  clearAllFilters: () => void;
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
  sources: DataSource[];
  yearRange: [number, number];
  filterOptions: FilterOptions;
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
          className="bg-transparent"
          aria-label={
            iconOnly
              ? `Filters${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`
              : undefined
          }
        >
          <Filter data-icon="inline-start" />
          {!iconOnly && "Filters"}
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85dvh]">
        <DrawerHeader className="text-left">
          <div className="flex items-center justify-between">
            <DrawerTitle className="text-lg font-semibold">Filters</DrawerTitle>
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {activeFilterCount}
              </Badge>
            )}
          </div>
          {activeFilterCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={clearAllFilters}
              className="mt-2 w-full bg-transparent"
            >
              Clear filters
            </Button>
          )}
        </DrawerHeader>
        <div className="max-h-[calc(85dvh-9rem)] overflow-y-auto px-4 pb-4">
          <SidebarContent
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
        <div className="bg-background border-t px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DrawerClose asChild>
            <Button className="h-11 w-full">Show results</Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
