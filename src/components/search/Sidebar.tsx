import { X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import type { DataSource } from "~/lib/types";
import { SidebarContent } from "./SidebarContent";

interface FilterOptions {
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
}

interface SidebarProps {
  setShowFilters: (show: boolean) => void;
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
}

export function Sidebar({
  setShowFilters,
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
}: SidebarProps) {
  return (
    <aside aria-labelledby="filters-heading" className="min-w-0">
      <div className="flex items-start justify-between gap-4 pb-4">
        <div>
          <h2 id="filters-heading" className="text-lg font-semibold">
            Filters
          </h2>
          <p className="text-muted-foreground mt-1 text-sm tabular-nums">
            {activeFilterCount > 0
              ? `${activeFilterCount} active`
              : "All inventory"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters}>
              Clear
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowFilters(false)}
            aria-label="Close filters"
          >
            <X />
          </Button>
        </div>
      </div>
      <Separator />
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
    </aside>
  );
}
