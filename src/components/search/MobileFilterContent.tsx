import { ChevronDown, Plus } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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

const FILTER_SECTIONS = [
  "sources",
  "makes",
  "yearRange",
  "colors",
  "states",
  "salvageYards",
] as const;
type FilterSectionKey = (typeof FILTER_SECTIONS)[number];
const FILTER_LABELS: Record<FilterSectionKey, string> = {
  sources: "Inventory sources",
  makes: "Make",
  yearRange: "Year",
  colors: "Color",
  states: "State",
  salvageYards: "Salvage yard",
};

interface MobileFilterContentProps {
  idPrefix?: string;
  defaultOpenSections?: "primary" | "all" | "none";
  containListScroll?: boolean;
  allowCustomValues?: boolean;
  progressiveDisclosure?: boolean;
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
  id,
  visible = true,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id?: string;
  visible?: boolean;
  title: string;
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  if (!visible) return null;
  return (
    <Collapsible defaultOpen={defaultOpen}>
      <CollapsibleTrigger
        id={id}
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
  allowCustomValues = false,
  progressiveDisclosure = false,
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
  const [addedSections, setAddedSections] = useState<FilterSectionKey[]>([]);
  const sectionToFocus = useRef<FilterSectionKey | null>(null);
  const minimumYear = yearRangeLimits?.min ?? 1900;
  const maximumYear = yearRangeLimits?.max ?? new Date().getFullYear();
  const hasYearFilter =
    yearRange[0] !== minimumYear || yearRange[1] !== maximumYear;
  const allSectionsOpen = defaultOpenSections === "all";
  const primarySectionsOpen = defaultOpenSections === "primary";
  const selectedSections: Record<FilterSectionKey, boolean> = {
    sources: sources.length > 0,
    makes: makes.length > 0,
    yearRange: hasYearFilter,
    colors: colors.length > 0,
    states: states.length > 0,
    salvageYards: salvageYards.length > 0,
  };
  // Keep a filter available while editing even after its last value is removed.
  const initiallySelectedSections = useRef(selectedSections);
  const isVisible = (section: FilterSectionKey) =>
    !progressiveDisclosure ||
    initiallySelectedSections.current[section] ||
    selectedSections[section] ||
    addedSections.includes(section);
  const unusedSections = FILTER_SECTIONS.filter(
    (section) => !isVisible(section),
  );

  const summarize = (values: string[]) =>
    progressiveDisclosure
      ? values.join(", ")
      : values.length > 0
        ? `${values.length} selected`
        : undefined;

  if (!canUseAdvancedFilters) return <AdvancedFiltersUpsell />;

  return (
    <div className="flex flex-col gap-3">
      <div className="divide-border flex flex-col divide-y">
        <FilterSection
          id={`${idPrefix}-sources-section`}
          visible={isVisible("sources")}
          title="Inventory sources"
          summary={
            sources.length === 0
              ? "All sources"
              : `${sources.length} of ${AVAILABLE_SOURCES.length} selected`
          }
          defaultOpen={allSectionsOpen || addedSections.includes("sources")}
        >
          <InventorySourcesFilter
            idPrefix={`${idPrefix}-source`}
            sources={sources}
            onSourcesChange={onSourcesChange}
          />
        </FilterSection>

        <FilterSection
          id={`${idPrefix}-makes-section`}
          visible={isVisible("makes")}
          title="Make"
          summary={summarize(makes)}
          defaultOpen={
            allSectionsOpen ||
            primarySectionsOpen ||
            addedSections.includes("makes")
          }
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
            allowCustomValues={allowCustomValues}
          />
        </FilterSection>

        <FilterSection
          id={`${idPrefix}-yearRange-section`}
          visible={isVisible("yearRange")}
          title="Year"
          summary={
            hasYearFilter ? `${yearRange[0]} to ${yearRange[1]}` : "All years"
          }
          defaultOpen={
            allSectionsOpen ||
            primarySectionsOpen ||
            addedSections.includes("yearRange")
          }
        >
          <YearRangeFilter
            yearRange={yearRange}
            onYearRangeChange={onYearRangeChange}
            minimumYear={minimumYear}
            maximumYear={maximumYear}
          />
        </FilterSection>

        <FilterSection
          id={`${idPrefix}-colors-section`}
          visible={isVisible("colors")}
          title="Color"
          summary={summarize(colors)}
          defaultOpen={allSectionsOpen || addedSections.includes("colors")}
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
            allowCustomValues={allowCustomValues}
          />
        </FilterSection>

        <FilterSection
          id={`${idPrefix}-states-section`}
          visible={isVisible("states")}
          title="State"
          summary={summarize(states)}
          defaultOpen={allSectionsOpen || addedSections.includes("states")}
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
            allowCustomValues={allowCustomValues}
          />
        </FilterSection>

        <FilterSection
          id={`${idPrefix}-salvageYards-section`}
          visible={isVisible("salvageYards")}
          title="Salvage yard"
          summary={summarize(salvageYards)}
          defaultOpen={
            allSectionsOpen || addedSections.includes("salvageYards")
          }
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
              allowCustomValues={allowCustomValues}
            />
            <Button asChild variant="link" size="sm" className="self-start">
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
        </FilterSection>
      </div>
      {unusedSections.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-11 self-start sm:min-h-9"
            >
              <Plus aria-hidden="true" />
              Add filter
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="z-[100]"
            onCloseAutoFocus={(event) => {
              const section = sectionToFocus.current;
              if (!section) return;
              const trigger = document.getElementById(
                `${idPrefix}-${section}-section`,
              );
              if (trigger) {
                event.preventDefault();
                trigger.focus();
              }
              sectionToFocus.current = null;
            }}
          >
            {unusedSections.map((section) => (
              <DropdownMenuItem
                key={section}
                className="min-h-11 sm:min-h-9"
                onSelect={() => {
                  sectionToFocus.current = section;
                  setAddedSections((previous) => [...previous, section]);
                }}
              >
                {FILTER_LABELS[section]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
