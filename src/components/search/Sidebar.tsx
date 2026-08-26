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
  canUseAdvancedFilters: boolean;
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
  canUseAdvancedFilters,
}: SidebarProps) {
  return (
    <div>
      {showFilters && (
        <div className="w-full shrink-0">
          <Card className="gap-0 py-0">
            <CardHeader className="gap-0 border-b px-4 py-3">
              <div className="relative -mx-2 flex items-center justify-center">
                <CardTitle className="text-base font-semibold text-balance">
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
                    className="size-8"
                    aria-label="Close filters"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="p-2">
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
              {activeFilterCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearAllFilters}
                  className="mt-2 w-full"
                >
                  Clear filters
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
