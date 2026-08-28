"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { trackRequestYardClick } from "~/lib/track-request-yard-click";
import type { DataSource } from "~/lib/types";
import {
  AdvancedFiltersUpsell,
  AVAILABLE_SOURCES,
  InventorySourcesFilter,
  YearRangeFilter,
} from "./FilterFields";
import type { SearchFilterOptions } from "./search-filter-options";
import { SearchableCheckboxList } from "./SearchableCheckboxList";

interface DesktopFiltersBarProps {
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
  yearRangeLimits: {
    min: number;
    max: number;
  };
  canUseAdvancedFilters: boolean;
}

function selectionSummary(values: string[], plural: string) {
  const onlyValue = values[0];
  if (values.length === 1 && onlyValue !== undefined) return onlyValue;
  return `${values.length} ${plural}`;
}

function FilterPopover({
  title,
  summary,
  active,
  description,
  children,
}: {
  title: string;
  summary: string;
  active: boolean;
  description: string;
  children: ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant={active ? "secondary" : "outline"}>
          <span className="max-w-48 truncate">
            {active ? `${title}: ${summary}` : title}
          </span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-2rem))]"
      >
        <div className="flex flex-col gap-4">
          <PopoverHeader>
            <PopoverTitle>{title}</PopoverTitle>
            <PopoverDescription>{description}</PopoverDescription>
          </PopoverHeader>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DesktopFiltersBar({
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
}: DesktopFiltersBarProps) {
  const hasYearFilter =
    yearRange[0] !== yearRangeLimits.min ||
    yearRange[1] !== yearRangeLimits.max;

  return (
    <section
      aria-labelledby="desktop-filters-heading"
      aria-describedby="desktop-filters-status"
      className="min-w-0"
    >
      <h2 id="desktop-filters-heading" className="sr-only">
        Refine inventory
      </h2>
      <p id="desktop-filters-status" className="sr-only">
        {activeFilterCount > 0
          ? `${activeFilterCount} active filters`
          : "Showing all inventory"}
      </p>

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {canUseAdvancedFilters ? (
            <div className="flex flex-wrap gap-2">
              <FilterPopover
                title="Make"
                summary={selectionSummary(makes, "makes")}
                active={makes.length > 0}
                description="Choose one or more vehicle makes."
              >
                <SearchableCheckboxList
                  name="desktop-make"
                  label="Make"
                  options={filterOptions.makes}
                  selected={makes}
                  onChange={onMakesChange}
                  searchPlaceholder="Search makes"
                  searchThreshold={10}
                  maxHeight={260}
                />
              </FilterPopover>

              <FilterPopover
                title="Year"
                summary={`${yearRange[0]} to ${yearRange[1]}`}
                active={hasYearFilter}
                description="Set the earliest and latest model years."
              >
                <YearRangeFilter
                  yearRange={yearRange}
                  onYearRangeChange={onYearRangeChange}
                  minimumYear={yearRangeLimits.min}
                  maximumYear={yearRangeLimits.max}
                />
              </FilterPopover>

              <FilterPopover
                title="State"
                summary={selectionSummary(states, "states")}
                active={states.length > 0}
                description="Limit inventory to specific states."
              >
                <SearchableCheckboxList
                  name="desktop-state"
                  label="State"
                  options={filterOptions.states}
                  selected={states}
                  onChange={onStatesChange}
                  searchPlaceholder="Search states"
                  searchThreshold={6}
                  maxHeight={280}
                />
              </FilterPopover>

              <FilterPopover
                title="Salvage yard"
                summary={selectionSummary(salvageYards, "salvage yards")}
                active={salvageYards.length > 0}
                description="Search inventory at individual yards."
              >
                <div className="flex flex-col gap-2">
                  <SearchableCheckboxList
                    name="desktop-yard"
                    label="Salvage yard"
                    options={filterOptions.salvageYards}
                    selected={salvageYards}
                    onChange={onSalvageYardsChange}
                    searchPlaceholder="Search yards"
                    searchThreshold={6}
                    maxHeight={280}
                  />
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="self-start"
                  >
                    <Link
                      href="/request-yard"
                      onClick={() =>
                        trackRequestYardClick({ location: "lot_filter" })
                      }
                    >
                      Request a missing yard
                    </Link>
                  </Button>
                </div>
              </FilterPopover>

              <FilterPopover
                title="Color"
                summary={selectionSummary(colors, "colors")}
                active={colors.length > 0}
                description="Choose one or more vehicle colors."
              >
                <SearchableCheckboxList
                  name="desktop-color"
                  label="Color"
                  options={filterOptions.colors}
                  selected={colors}
                  onChange={onColorsChange}
                  searchPlaceholder="Search colors"
                  searchThreshold={12}
                  maxHeight={260}
                />
              </FilterPopover>

              <FilterPopover
                title="Inventory sources"
                summary={`${sources.length} of ${AVAILABLE_SOURCES.length}`}
                active={sources.length > 0}
                description="Choose which inventory networks to include."
              >
                <InventorySourcesFilter
                  idPrefix="desktop-source"
                  sources={sources}
                  onSourcesChange={onSourcesChange}
                />
              </FilterPopover>
            </div>
          ) : (
            <AdvancedFiltersUpsell layout="inline" />
          )}
        </div>

        {activeFilterCount > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={clearAllFilters}
          >
            Clear
          </Button>
        )}
      </div>
    </section>
  );
}
