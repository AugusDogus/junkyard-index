import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
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

interface MobileFilterContentProps {
  idPrefix?: string;
  defaultOpenSections?: "primary" | "all" | "none";
  containListScroll?: boolean;
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
}

function FilterSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        type="button"
        className="group focus-visible:ring-ring/50 flex w-full items-center justify-between gap-4 py-4 text-left outline-none focus-visible:ring-2"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          {summary && (
            <span className="text-muted-foreground mt-0.5 block truncate text-xs tabular-nums">
              {summary}
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden="true"
          className="text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function MobileFilterContent({
  idPrefix = "mobile",
  defaultOpenSections = "primary",
  containListScroll = true,
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
}: MobileFilterContentProps) {
  if (!canUseAdvancedFilters) {
    return <AdvancedFiltersUpsell />;
  }

  const minimumYear = yearRangeLimits?.min ?? 1900;
  const maximumYear = yearRangeLimits?.max ?? new Date().getFullYear();
  const hasYearFilter =
    yearRange[0] !== minimumYear || yearRange[1] !== maximumYear;
  const allSectionsOpen = defaultOpenSections === "all";
  const primarySectionsOpen = defaultOpenSections === "primary";

  return (
    <div className="divide-border flex flex-col divide-y">
      <FilterSection
        title="Inventory sources"
        summary={
          sources.length === 0
            ? "All sources"
            : `${sources.length} of ${AVAILABLE_SOURCES.length} selected`
        }
        defaultOpen={allSectionsOpen}
      >
        <InventorySourcesFilter
          idPrefix={`${idPrefix}-source`}
          sources={sources}
          onSourcesChange={onSourcesChange}
        />
      </FilterSection>

      <FilterSection
        title="Make"
        summary={makes.length > 0 ? `${makes.length} selected` : undefined}
        defaultOpen={allSectionsOpen || primarySectionsOpen}
      >
        <SearchableCheckboxList
          name={`${idPrefix}-make`}
          label="Make"
          options={filterOptions.makes}
          selected={makes}
          onChange={onMakesChange}
          searchPlaceholder="Search makes"
          searchThreshold={10}
          maxHeight={220}
          containScroll={containListScroll}
        />
      </FilterSection>

      <FilterSection
        title="Year"
        summary={
          hasYearFilter ? `${yearRange[0]} to ${yearRange[1]}` : "All years"
        }
        defaultOpen={allSectionsOpen || primarySectionsOpen}
      >
        <YearRangeFilter
          yearRange={yearRange}
          onYearRangeChange={onYearRangeChange}
          minimumYear={minimumYear}
          maximumYear={maximumYear}
        />
      </FilterSection>

      <FilterSection
        title="Color"
        summary={colors.length > 0 ? `${colors.length} selected` : undefined}
        defaultOpen={allSectionsOpen}
      >
        <SearchableCheckboxList
          name={`${idPrefix}-color`}
          label="Color"
          options={filterOptions.colors}
          selected={colors}
          onChange={onColorsChange}
          searchPlaceholder="Search colors"
          searchThreshold={12}
          maxHeight={200}
          containScroll={containListScroll}
        />
      </FilterSection>

      <FilterSection
        title="State"
        summary={states.length > 0 ? `${states.length} selected` : undefined}
        defaultOpen={allSectionsOpen}
      >
        <SearchableCheckboxList
          name={`${idPrefix}-state`}
          label="State"
          options={filterOptions.states}
          selected={states}
          onChange={onStatesChange}
          searchPlaceholder="Search states"
          searchThreshold={6}
          maxHeight={240}
          containScroll={containListScroll}
        />
      </FilterSection>

      <FilterSection
        title="Salvage yard"
        summary={
          salvageYards.length > 0
            ? `${salvageYards.length} selected`
            : undefined
        }
        defaultOpen={allSectionsOpen}
      >
        <div className="flex flex-col gap-2">
          <SearchableCheckboxList
            name={`${idPrefix}-yard`}
            label="Salvage yard"
            options={filterOptions.salvageYards}
            selected={salvageYards}
            onChange={onSalvageYardsChange}
            searchPlaceholder="Search yards"
            searchThreshold={6}
            maxHeight={240}
            containScroll={containListScroll}
          />
          <Button asChild variant="link" size="sm" className="self-start">
            <Link
              href="/request-yard"
              onClick={() => trackRequestYardClick({ location: "lot_filter" })}
            >
              Request a missing yard
            </Link>
          </Button>
        </div>
      </FilterSection>
    </div>
  );
}
