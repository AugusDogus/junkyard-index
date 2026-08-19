import { X } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import type { DataSource } from "~/lib/types";
import { SidebarContent } from "./SidebarContent";

interface FilterOptions {
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
}

interface SidebarProps {
  showFilters: boolean;
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
}

export function Sidebar({
  showFilters,
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
}: SidebarProps) {
  return (
    <div className="h-full">
      {showFilters && (
        <div className="h-full w-full shrink-0">
          <Card className="h-full gap-0 overflow-hidden py-0">
            <CardHeader className="shrink-0 gap-0 px-4 py-2">
              <div className="relative flex items-center justify-center">
                <CardTitle className="text-balance text-lg font-bold">
                  Filters
                </CardTitle>
                <div className="absolute right-0 flex items-center gap-2">
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {activeFilterCount}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowFilters(false)}
                    className="size-8 p-0"
                    aria-label="Close filters"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
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
            </CardHeader>

            <CardContent className="scrollbar-thin-themed min-h-0 flex-1 overflow-y-auto px-4 pb-4 [scrollbar-gutter:stable]">
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
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
