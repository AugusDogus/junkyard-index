import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/ui/collapsible";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/components/ui/field";
import { Slider } from "~/components/ui/slider";
import { PLANS } from "~/lib/plans";
import { trackRequestYardClick } from "~/lib/track-request-yard-click";
import type { DataSource } from "~/lib/types";
import { SearchableCheckboxList } from "./SearchableCheckboxList";

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
  upullitdavie: "U Pull It Davie",
  gopullit: "GO Pull-It",
  row52: "Row52 / Pick-n-Pull",
  autorecycler: "AutoRecycler.io",
};

const AVAILABLE_SOURCES: DataSource[] = [
  "pyp",
  "pullapart",
  "upullitne",
  "upullitdavie",
  "gopullit",
  "row52",
  "autorecycler",
];

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
      <CollapsibleTrigger className="group focus-visible:ring-ring/50 flex w-full items-center justify-between gap-4 py-4 text-left outline-none focus-visible:ring-2">
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

function AdvancedFiltersUpsell() {
  return (
    <div className="flex flex-col items-start gap-4 py-2">
      <div className="flex max-w-sm flex-col gap-2">
        <h3 className="text-base font-semibold">Filter the full inventory</h3>
        <p className="text-muted-foreground text-sm leading-6">
          Lite adds filters for source, make, year, color, state, and individual
          salvage yards from ${PLANS.lite.monthlyPrice}/month.
        </p>
      </div>
      <Button asChild size="sm">
        <Link href="/pricing">Compare plans</Link>
      </Button>
    </div>
  );
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
  canUseAdvancedFilters,
}: SidebarContentProps) {
  if (!canUseAdvancedFilters) {
    return <AdvancedFiltersUpsell />;
  }

  const minimumYear = yearRangeLimits?.min ?? 1900;
  const maximumYear = yearRangeLimits?.max ?? new Date().getFullYear();
  const hasYearFilter =
    yearRange[0] !== minimumYear || yearRange[1] !== maximumYear;

  return (
    <div className="divide-border flex flex-col divide-y">
      <FilterSection
        title="Inventory sources"
        summary={
          sources.length === 0
            ? "All sources"
            : `${sources.length} of ${AVAILABLE_SOURCES.length} selected`
        }
      >
        <FieldSet className="gap-3">
          <FieldLegend className="sr-only">Inventory sources</FieldLegend>
          <FieldGroup className="gap-1">
            {AVAILABLE_SOURCES.map((source) => {
              const isChecked =
                sources.length === 0 || sources.includes(source);
              return (
                <Field
                  key={source}
                  orientation="horizontal"
                  className="hover:bg-muted/60 min-h-9 gap-3 rounded-md px-2 py-2"
                >
                  <Checkbox
                    id={`source-${source}`}
                    checked={isChecked}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        if (sources.length === 0) return;
                        const newSources = [...sources, source];
                        onSourcesChange(
                          newSources.length === AVAILABLE_SOURCES.length
                            ? []
                            : newSources,
                        );
                        return;
                      }

                      if (sources.length === 0) {
                        onSourcesChange(
                          AVAILABLE_SOURCES.filter(
                            (availableSource) => availableSource !== source,
                          ),
                        );
                        return;
                      }

                      const newSources = sources.filter(
                        (selectedSource) => selectedSource !== source,
                      );
                      if (newSources.length > 0) {
                        onSourcesChange(newSources);
                      }
                    }}
                  />
                  <FieldLabel
                    htmlFor={`source-${source}`}
                    className="min-w-0 cursor-pointer"
                  >
                    <span className="truncate">{SOURCE_LABELS[source]}</span>
                  </FieldLabel>
                </Field>
              );
            })}
          </FieldGroup>
        </FieldSet>
      </FilterSection>

      {filterOptions.makes.length > 1 && (
        <FilterSection
          title="Make"
          summary={makes.length > 0 ? `${makes.length} selected` : undefined}
          defaultOpen
        >
          <SearchableCheckboxList
            name="make"
            label="Make"
            options={filterOptions.makes}
            selected={makes}
            onChange={onMakesChange}
            searchPlaceholder="Search makes"
            searchThreshold={10}
            maxHeight={220}
          />
        </FilterSection>
      )}

      <FilterSection
        title="Year"
        summary={
          hasYearFilter ? `${yearRange[0]} to ${yearRange[1]}` : "All years"
        }
        defaultOpen
      >
        <div className="flex flex-col gap-5 px-2">
          <div className="grid grid-cols-2 gap-4 text-sm tabular-nums">
            <div>
              <span className="text-muted-foreground block text-xs">
                Earliest
              </span>
              <output className="mt-1 block font-medium">{yearRange[0]}</output>
            </div>
            <div className="text-right">
              <span className="text-muted-foreground block text-xs">
                Latest
              </span>
              <output className="mt-1 block font-medium">{yearRange[1]}</output>
            </div>
          </div>
          <Slider
            value={yearRange}
            onValueChange={(value) => {
              const min = value[0];
              const max = value[1];
              if (typeof min === "number" && typeof max === "number") {
                onYearRangeChange([min, max]);
              }
            }}
            min={minimumYear}
            max={maximumYear}
            step={1}
            aria-label="Vehicle year range"
            onPointerDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}
          />
        </div>
      </FilterSection>

      <FilterSection
        title="Color"
        summary={colors.length > 0 ? `${colors.length} selected` : undefined}
      >
        <SearchableCheckboxList
          name="color"
          label="Color"
          options={filterOptions.colors}
          selected={colors}
          onChange={onColorsChange}
          searchPlaceholder="Search colors"
          searchThreshold={12}
          maxHeight={200}
        />
      </FilterSection>

      <FilterSection
        title="State"
        summary={states.length > 0 ? `${states.length} selected` : undefined}
      >
        <SearchableCheckboxList
          name="state"
          label="State"
          options={filterOptions.states}
          selected={states}
          onChange={onStatesChange}
          searchPlaceholder="Search states"
          searchThreshold={6}
          maxHeight={240}
        />
      </FilterSection>

      <FilterSection
        title="Salvage yard"
        summary={
          salvageYards.length > 0
            ? `${salvageYards.length} selected`
            : undefined
        }
      >
        <div className="flex flex-col gap-2">
          <SearchableCheckboxList
            name="yard"
            label="Salvage yard"
            options={filterOptions.salvageYards}
            selected={salvageYards}
            onChange={onSalvageYardsChange}
            searchPlaceholder="Search yards"
            searchThreshold={6}
            maxHeight={240}
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
