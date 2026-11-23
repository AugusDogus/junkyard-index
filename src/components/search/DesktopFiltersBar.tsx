"use client";

import { YARD_TYPE_OPTIONS, type YardType } from "~/lib/yard-service";
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
import { HiddenSources } from "~/lib/hidden-source";
import type { DataSource } from "~/lib/types";
import {
  AdvancedFiltersUpsell,
  AVAILABLE_SOURCES,
  InventorySourcesFilter,
  YardTypeFilter,
  YearRangeFilter,
} from "./FilterFields";
import type { SearchFilterOptions } from "./search-filter-options";
import { SearchableCheckboxList } from "./SearchableCheckboxList";

interface DesktopFiltersBarProps {
  advancedSearchControl?: ReactNode;
  activeFilterCount: number;
  clearAllFilters: () => void;
  makes: string[];
  colors: string[];
  states: string[];
  salvageYards: string[];
  sources: DataSource[];
  yardTypes: YardType[];
  yearRange: [number, number];
  filterOptions: SearchFilterOptions;
  /** Loading or error state for `filterOptions`, shown in each list. */
  filterOptionsFeedback?: ReactNode;
  onMakesChange: (makes: string[]) => void;
  onColorsChange: (colors: string[]) => void;
  onStatesChange: (states: string[]) => void;
  onSalvageYardsChange: (salvageYards: string[]) => void;
  onSourcesChange: (sources: DataSource[]) => void;
  onYardTypesChange: (types: YardType[]) => void;
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
        portal={false}
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
  advancedSearchControl,
  activeFilterCount,
  clearAllFilters,
  makes,
  colors,
  states,
  salvageYards,
  sources,
  yardTypes,
  yearRange,
  filterOptions,
  filterOptionsFeedback,
  onMakesChange,
  onColorsChange,
  onStatesChange,
  onSalvageYardsChange,
  onSourcesChange,
  onYardTypesChange,
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
      // Radix positions popovers with position: fixed, moved by script after
      // each scroll, so a portaled panel trails its trigger by a frame. The
      // transform makes this section the panels' containing block, so they
      // scroll with their triggers. Stay under the sticky search bar (z-40).
      className="relative z-30 min-w-0 [transform:translateZ(0)]"
    >
      <h2 id="desktop-filters-heading" className="sr-only">
        Refine inventory
      </h2>
      <p id="desktop-filters-status" className="sr-only">
        {activeFilterCount > 0
          ? `${activeFilterCount} active filters`
          : "Showing all inventory"}
      </p>

      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2">
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
          </div>
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
                  feedback={filterOptionsFeedback}
                  selected={makes}
                  onChange={onMakesChange}
                  searchPlaceholder="Search makes"
                  searchThreshold={10}
                  maxHeight={260}
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
                  feedback={filterOptionsFeedback}
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
                    feedback={filterOptionsFeedback}
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
                  feedback={filterOptionsFeedback}
                  selected={colors}
                  onChange={onColorsChange}
                  searchPlaceholder="Search colors"
                  searchThreshold={12}
                  maxHeight={260}
                />
              </FilterPopover>

              <FilterPopover
                title="Yard type"
                summary={selectionSummary(
                  YARD_TYPE_OPTIONS.filter((option) =>
                    yardTypes.includes(option.value),
                  ).map((option) => option.label),
                  "types",
                )}
                active={yardTypes.length > 0}
                description="Choose who pulls the parts. Yards offering both match either option."
              >
                <YardTypeFilter
                  idPrefix="desktop-yard-type"
                  yardTypes={yardTypes}
                  onYardTypesChange={onYardTypesChange}
                />
              </FilterPopover>
              <FilterPopover
                title="Inventory sources"
                summary={`${HiddenSources.shown(sources).length} of ${AVAILABLE_SOURCES.length}`}
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

        <div className="flex shrink-0 items-center gap-3">
          {advancedSearchControl}
          {activeFilterCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAllFilters}
            >
              Clear
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
