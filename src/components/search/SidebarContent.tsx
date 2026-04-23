import { ChevronDown } from "lucide-react";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import { Label } from "~/components/ui/label";
import { Slider } from "~/components/ui/slider";
import {
  MAX_VEHICLE_YEAR,
  MIN_VEHICLE_YEAR,
} from "~/lib/search-filter-bounds";
import type { DataSource } from "~/lib/types";

interface FilterOptions {
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
}

const SOURCE_LABELS: Record<DataSource, string> = {
  pyp: "Pick Your Part (PYP)",
  pullapart: "Pull-A-Part / U-Pull-&-Pay",
  upullitne: "U Pull-It (NE/IA)",
  row52: "Row52 / Pick-n-Pull",
  autorecycler: "AutoRecycler.io",
};

interface SidebarContentProps {
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

export function SidebarContent({
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
}: SidebarContentProps) {
  const availableSources: DataSource[] = [
    "pyp",
    "pullapart",
    "upullitne",
    "row52",
    "autorecycler",
  ];

  return (
    <div className="space-y-6">
      <Collapsible defaultOpen>
        <CollapsibleTrigger className="hover:bg-accent flex w-full items-center justify-between rounded p-2">
          <span className="font-medium">Salvage Yards</span>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {availableSources.map((source) => {
            const isChecked = sources.length === 0 || sources.includes(source);

            return (
              <div
                key={source}
                className="flex items-center space-x-2 pr-3 pl-3"
              >
                <Checkbox
                  id={`source-${source}`}
                  checked={isChecked}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      if (sources.length === 0) return;
                      const newSources = [...sources, source];
                      onSourcesChange(
                        newSources.length === availableSources.length
                          ? []
                          : newSources,
                      );
                    } else {
                      if (sources.length === 0) {
                        onSourcesChange(
                          availableSources.filter((s) => s !== source),
                        );
                      } else {
                        const newSources = sources.filter((s) => s !== source);
                        if (newSources.length === 0) return;
                        onSourcesChange(newSources);
                      }
                    }
                  }}
                />
                <Label htmlFor={`source-${source}`} className="text-sm">
                  {SOURCE_LABELS[source]}
                </Label>
              </div>
            );
          })}
        </CollapsibleContent>
      </Collapsible>

      {filterOptions.makes.length > 1 && (
        <Collapsible defaultOpen>
          <CollapsibleTrigger className="hover:bg-accent flex w-full items-center justify-between rounded p-2">
            <span className="font-medium">Make</span>
            <ChevronDown className="h-4 w-4" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2">
            {filterOptions.makes.map((make) => (
              <div key={make} className="flex items-center space-x-2 pr-3 pl-3">
                <Checkbox
                  id={`make-${make}`}
                  checked={makes.includes(make)}
                  onCheckedChange={() => {
                    if (makes.includes(make)) {
                      onMakesChange(makes.filter((m) => m !== make));
                    } else {
                      onMakesChange([...makes, make]);
                    }
                  }}
                />
                <Label htmlFor={`make-${make}`} className="text-sm">
                  {make}
                </Label>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible defaultOpen>
        <CollapsibleTrigger className="hover:bg-accent flex w-full items-center justify-between rounded p-2">
          <span className="font-medium">Year Range</span>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-4">
          <div className="px-2">
            <div className="text-muted-foreground mb-2 flex justify-between text-sm">
              <span>{yearRange?.[0]}</span>
              <span>{yearRange?.[1]}</span>
            </div>
            <Slider
              value={yearRange}
              onValueChange={(value) => {
                const [min, max] = value as [number, number];
                onYearRangeChange([min, max]);
              }}
              min={yearRangeLimits?.min ?? MIN_VEHICLE_YEAR}
              max={yearRangeLimits?.max ?? MAX_VEHICLE_YEAR}
              step={1}
              className="w-full"
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger className="hover:bg-accent flex w-full items-center justify-between rounded p-2">
          <span className="font-medium">Color</span>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {filterOptions.colors.map((color) => (
            <div key={color} className="flex items-center space-x-2 pr-3 pl-3">
              <Checkbox
                id={`color-${color}`}
                checked={colors.includes(color)}
                onCheckedChange={() => {
                  if (colors.includes(color)) {
                    onColorsChange(colors.filter((c) => c !== color));
                  } else {
                    onColorsChange([...colors, color]);
                  }
                }}
              />
              <Label htmlFor={`color-${color}`} className="text-sm">
                {color}
              </Label>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger className="hover:bg-accent flex w-full items-center justify-between rounded p-2">
          <span className="font-medium">State</span>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {filterOptions.states.map((state) => (
            <div key={state} className="flex items-center space-x-2 pr-3 pl-3">
              <Checkbox
                id={`state-${state}`}
                checked={states.includes(state)}
                onCheckedChange={() => {
                  if (states.includes(state)) {
                    onStatesChange(states.filter((s) => s !== state));
                  } else {
                    onStatesChange([...states, state]);
                  }
                }}
              />
              <Label htmlFor={`state-${state}`} className="text-sm">
                {state}
              </Label>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      <Collapsible>
        <CollapsibleTrigger className="hover:bg-accent flex w-full items-center justify-between rounded p-2">
          <span className="font-medium">Lot</span>
          <ChevronDown className="h-4 w-4" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2">
          {filterOptions.salvageYards.map((yard) => (
            <div key={yard} className="flex items-center space-x-2 pr-3 pl-3">
              <Checkbox
                id={`yard-${yard}`}
                checked={salvageYards.includes(yard)}
                onCheckedChange={() => {
                  if (salvageYards.includes(yard)) {
                    onSalvageYardsChange(
                      salvageYards.filter((y) => y !== yard),
                    );
                  } else {
                    onSalvageYardsChange([...salvageYards, yard]);
                  }
                }}
              />
              <Label htmlFor={`yard-${yard}`} className="text-sm">
                {yard}
              </Label>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
