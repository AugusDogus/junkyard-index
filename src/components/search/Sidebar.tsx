import { X } from "lucide-react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
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
  yearRange: [number, number];
  filterOptions: FilterOptions;
  onMakesChange: (makes: string[]) => void;
  onColorsChange: (colors: string[]) => void;
  onStatesChange: (states: string[]) => void;
  onSalvageYardsChange: (salvageYards: string[]) => void;
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
  yearRange,
  filterOptions,
  onMakesChange,
  onColorsChange,
  onStatesChange,
  onSalvageYardsChange,
  onYearRangeChange,
  yearRangeLimits,
}: SidebarProps) {
  return (
    <div>
      {showFilters && (
        <div className="w-80 flex-shrink-0">
          <Card className="max-h-[calc(100vh-3rem)] overflow-y-auto">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg font-bold">Filters</CardTitle>
                <div className="flex items-center gap-2">
                  {activeFilterCount > 0 && (
                    <Badge variant="secondary" className="text-xs">
                      {activeFilterCount}
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowFilters(false)}
                    className="h-8 w-8 p-0"
                  >
                    <X className="h-4 w-4" />
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

            <CardContent
              className="ml-2 max-h-[calc(100vh-200px)]"
              style={{
                overflowY: "auto",
                scrollbarGutter: "stable",
                scrollbarWidth: "thin",
                scrollbarColor: "rgb(203 213 225) transparent",
              }}
            >
              <SidebarContent
                makes={makes}
                colors={colors}
                states={states}
                salvageYards={salvageYards}
                yearRange={yearRange}
                filterOptions={filterOptions}
                onMakesChange={onMakesChange}
                onColorsChange={onColorsChange}
                onStatesChange={onStatesChange}
                onSalvageYardsChange={onSalvageYardsChange}
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
