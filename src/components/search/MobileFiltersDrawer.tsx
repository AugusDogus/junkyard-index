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
  iconOnly,
}: MobileFiltersDrawerProps) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Button
          variant="outline"
          size={iconOnly ? "sm" : "default"}
          className="flex items-center gap-2 bg-transparent"
          aria-label={iconOnly ? `Filters${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}` : undefined}
        >
          <Filter className={iconOnly ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {!iconOnly && "Filters"}
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className={iconOnly ? "text-[10px]" : "ml-1 text-xs"}>
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="text-left">
          <div className="flex items-center justify-between">
            <DrawerTitle className="text-lg font-bold">Filters</DrawerTitle>
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="text-xs">
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
              Clear All Filters
            </Button>
          )}
        </DrawerHeader>
        <div className="max-h-[calc(85vh-120px)] overflow-y-auto px-4 pb-4">
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
          />
        </div>
        <div className="bg-background border-t p-4">
          <DrawerClose asChild>
            <Button className="w-full">Apply Filters</Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
