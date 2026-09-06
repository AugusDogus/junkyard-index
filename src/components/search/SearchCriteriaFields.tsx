"use client";

import { useId, type ReactNode } from "react";
import { MobileFilterContent } from "~/components/search/MobileFilterContent";
import { SearchQueryFields } from "~/components/search/SearchQueryFields";
import { SEARCH_SORT_OPTIONS } from "~/components/search/search-routing";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { InventoryFilterOptions } from "~/lib/inventory-filter-options";
import { SEARCHABLE_VEHICLE_YEAR_RANGE } from "~/lib/saved-search-filters";
import type { SearchCriteria } from "~/lib/search-criteria";
import { cn } from "~/lib/utils";

export function SearchCriteriaFields({
  value,
  onChange,
  filterOptions,
  filterOptionsFeedback,
  portalContainer,
  progressiveDisclosure = false,
}: {
  value: SearchCriteria;
  onChange: (criteria: SearchCriteria) => void;
  filterOptions?: InventoryFilterOptions;
  filterOptionsFeedback?: ReactNode;
  portalContainer: HTMLElement | null;
  progressiveDisclosure?: boolean;
}) {
  const id = useId();
  const available = InventoryFilterOptions.withSelected(filterOptions, value);
  const setField = <Key extends keyof SearchCriteria>(
    key: Key,
    next: SearchCriteria[Key],
  ) => onChange({ ...value, [key]: next });
  return (
    <FieldGroup
      className={cn(
        "grid items-start gap-8 lg:grid-cols-2",
        progressiveDisclosure && "gap-6",
      )}
    >
      <FieldSet
        className={cn("min-w-0 gap-5", progressiveDisclosure && "gap-3")}
      >
        <FieldLegend>Find vehicles</FieldLegend>
        <SearchQueryFields
          progressiveDisclosure={progressiveDisclosure}
          value={value.query}
          queryMode={value.queryMode}
          onChange={(query, queryMode) =>
            onChange({ ...value, query, queryMode })
          }
        />
      </FieldSet>
      <FieldSet className="min-w-0 gap-4">
        <FieldLegend>Filters and sorting</FieldLegend>
        <FieldDescription>
          {progressiveDisclosure
            ? "Filters can match future inventory, too."
            : "Keywords are optional. Choose filters or type a value to add it, even when no vehicles match yet."}
        </FieldDescription>
        <Field>
          <FieldLabel htmlFor={`${id}-sort`}>Order results by</FieldLabel>
          <Select
            value={value.sortBy}
            onValueChange={(sort) => setField("sortBy", sort)}
          >
            <SelectTrigger id={`${id}-sort`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent container={portalContainer}>
              <SelectGroup>
                {SEARCH_SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {filterOptionsFeedback}
        <MobileFilterContent
          progressiveDisclosure={progressiveDisclosure}
          idPrefix={id}
          defaultOpenSections="none"
          containListScroll={false}
          allowCustomValues
          {...value}
          filterOptions={available}
          onMakesChange={(next) => setField("makes", next)}
          onColorsChange={(next) => setField("colors", next)}
          onStatesChange={(next) => setField("states", next)}
          onSalvageYardsChange={(next) => setField("salvageYards", next)}
          onSourcesChange={(next) => setField("sources", next)}
          onYearRangeChange={(next) => setField("yearRange", next)}
          yearRangeLimits={SEARCHABLE_VEHICLE_YEAR_RANGE}
          canUseAdvancedFilters
        />
      </FieldSet>
    </FieldGroup>
  );
}
